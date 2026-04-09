/**
 * @fileoverview Supervisor — менеджер процессов
 * @description Отвечает за управление жизненным циклом Xvfb и дочерних сервисов
 *
 * Функции:
 * - Запуск xvfb-run в среде Linux
 * - Запуск server.js через child_process.spawn
 * - Прослушивание IPC-канала для получения команд перезапуска
 * - Автоматический перезапуск при падении дочернего процесса
 */

import { spawn, spawnSync } from 'child_process';
import net from 'net';
import os from 'os';
import path from 'path';
import fs from 'fs';

// ==================== Настройки ====================

const isWindows = os.platform() === 'win32';

// Путь к IPC-каналу
const IPC_PATH = isWindows
    ? '\\\\.\\pipe\\webai2api-supervisor'
    : path.join(os.tmpdir(), 'webai2api-supervisor.sock');

// Задержка перезапуска (мс)
const RESTART_DELAY = 1000;

// Аргументы для следующего перезапуска (задаются через IPC)
let restartArgs = null;

// ==================== Утилиты ====================

/**
 * Простое логирование
 * @param {string} level
 * @param {string} message
 */
function log(level, message) {
    const now = new Date();
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
    const levelTag = level === 'ERROR' ? 'ERRO' : level;
    console.log(`${date} ${time} [${levelTag}] [Сторож] ${message}`);
}

/**
 * Проверить наличие команды (Linux)
 * @param {string} cmd
 * @returns {boolean}
 */
function checkCommand(cmd) {
    if (isWindows) return true;
    const result = spawnSync('which', [cmd], { encoding: 'utf8' });
    return result.status === 0;
}

/**
 * Проверить доступность порта
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortAvailable(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close();
            resolve(true);
        });
        server.listen(port, '127.0.0.1');
    });
}

/**
 * Найти свободный порт
 * @param {number} startPort - начальный порт
 * @param {number} maxTries - максимальное число попыток
 * @returns {Promise<number|null>}
 */
async function findAvailablePort(startPort, maxTries = 10) {
    for (let i = 0; i < maxTries; i++) {
        const port = startPort + i;
        if (await isPortAvailable(port)) {
            return port;
        }
    }
    return null;
}

/**
 * Проверить доступность номера дисплея Xvfb
 * @param {number} displayNum
 * @returns {boolean}
 */
function isDisplayAvailable(displayNum) {
    const lockFile = `/tmp/.X${displayNum}-lock`;
    const socketFile = `/tmp/.X11-unix/X${displayNum}`;
    return !fs.existsSync(lockFile) && !fs.existsSync(socketFile);
}

/**
 * Найти доступный номер дисплея
 * @param {number} startNum - начальный номер
 * @param {number} maxTries - максимальное число попыток
 * @returns {number}
 */
function findAvailableDisplay(startNum = 50, maxTries = 50) {
    for (let i = 0; i < maxTries; i++) {
        const num = startNum + i;
        if (isDisplayAvailable(num)) {
            return num;
        }
    }
    // Запасной вариант: случайный номер дисплея
    return 50 + Math.floor(Math.random() * 50);
}

// ==================== IPC-сервер ====================

let serverProcess = null;
let isRestarting = false;

// Состояние VNC
let vncInfo = {
    enabled: false,
    port: 5900,
    display: ':99',
    xvfbMode: false
};

/**
 * Запустить IPC-сервер
 */
function startIpcServer() {
    // Удалить старый socket-файл (Linux)
    if (!isWindows && fs.existsSync(IPC_PATH)) {
        try {
            fs.unlinkSync(IPC_PATH);
        } catch { }
    }

    const ipcServer = net.createServer((socket) => {
        socket.on('data', (data) => {
            const command = data.toString().trim();

            if (command === 'RESTART' || command.startsWith('RESTART:')) {
                // Поддержка формата RESTART:аргументы
                const extraArgs = command.includes(':') ? command.split(':')[1].split(' ').filter(Boolean) : [];
                log('INFO', `Получена IPC-команда: RESTART${extraArgs.length ? ' (аргументы: ' + extraArgs.join(' ') + ')' : ''}`);
                socket.write('OK\n');
                socket.end();
                restartServer(extraArgs);
            } else if (command === 'STOP') {
                log('INFO', 'Получена IPC-команда: STOP');
                socket.write('OK\n');
                socket.end();
                stopAll();
            } else if (command === 'GET_VNC_INFO') {
                // Вернуть информацию о состоянии VNC и закрыть соединение
                socket.write(JSON.stringify(vncInfo) + '\n');
                socket.end();
            } else {
                socket.write('UNKNOWN_COMMAND\n');
                socket.end();
            }
        });
    });

    ipcServer.listen(IPC_PATH, () => {
        log('INFO', `IPC-сервер запущен: ${IPC_PATH}`);
    });

    ipcServer.on('error', (err) => {
        log('ERROR', `Ошибка IPC-сервера: ${err.message}`);
    });

    return ipcServer;
}

// ==================== Управление дочерними процессами ====================

// Коды завершения, после которых не следует перезапускать
const FATAL_EXIT_CODES = [
    78,  // Ошибка конфигурации/зависимостей
];

/**
 * Запустить дочерний процесс server.js
 * @param {string[]} [extraArgs] - дополнительные аргументы командной строки
 */
function startServer(extraArgs = []) {
    const serverPath = path.join(process.cwd(), 'src', 'server', 'server.js');

    // Проверить наличие server.js
    if (!fs.existsSync(serverPath)) {
        log('ERROR', `Файл server.js не найден: ${serverPath}`);
        process.exit(1);
    }

    const args = [serverPath, ...extraArgs];
    const env = {
        ...process.env,
        SUPERVISOR_IPC: IPC_PATH
    };

    log('INFO', 'Запуск дочернего сервиса (src/server/server.js)...');

    serverProcess = spawn(process.execPath, args, {
        cwd: process.cwd(),
        env,
        stdio: 'inherit'  // Перенаправить stdio дочернего процесса в основную консоль
    });

    serverProcess.on('exit', (code, signal) => {
        if (isRestarting) {
            log('INFO', 'Дочерний сервис остановлен, подготовка к перезапуску...');
            isRestarting = false;
            // Использовать новые аргументы, если они заданы, иначе исходные
            const argsToUse = restartArgs !== null ? restartArgs : extraArgs;
            restartArgs = null; // Сброс
            setTimeout(() => startServer(argsToUse), RESTART_DELAY);
        } else if (code !== 0 && code !== null) {
            // Проверить, является ли ошибка неустранимой
            if (FATAL_EXIT_CODES.includes(code)) {
                log('ERROR', `Дочерний сервис завершился из-за ошибки конфигурации/зависимостей (код: ${code}), автоперезапуск отключён`);
                process.exit(code);
            }
            log('WARN', `Дочерний сервис завершился аварийно (код: ${code}), автоматический перезапуск...`);
            setTimeout(() => startServer(extraArgs), RESTART_DELAY);
        } else {
            log('INFO', 'Дочерний сервис завершился штатно');
            process.exit(0);
        }
    });

    serverProcess.on('error', (err) => {
        log('ERROR', `Не удалось запустить дочерний сервис: ${err.message}`);
        process.exit(1);
    });
}

/**
 * Перезапустить дочерний сервис
 * @param {string[]} [newArgs] - новые аргументы запуска (заменяют прежние)
 */
function restartServer(newArgs = null) {
    if (isRestarting) {
        log('WARN', 'Перезапуск уже выполняется, повторный запрос проигнорирован');
        return;
    }

    isRestarting = true;
    log('INFO', 'Перезапуск дочернего сервиса...');

    // Если переданы новые аргументы, обновить параметры запуска
    if (newArgs !== null) {
        restartArgs = newArgs;
    }

    if (serverProcess) {
        serverProcess.kill('SIGTERM');
    }
}

/**
 * Остановить все сервисы
 */
function stopAll() {
    log('INFO', 'Остановка всех сервисов...');

    if (serverProcess) {
        serverProcess.kill('SIGTERM');
    }

    setTimeout(() => process.exit(0), 500);
}

// ==================== Обработка Xvfb (Linux) ====================

/**
 * Запустить в Xvfb
 * @param {string[]} originalArgs - исходные аргументы командной строки
 */
function startInXvfb(originalArgs) {
    if (!checkCommand('xvfb-run')) {
        log('ERROR', 'Команда xvfb-run не найдена');
        log('ERROR', 'Установите Xvfb:');
        log('ERROR', ' - Ubuntu/Debian: sudo apt install xvfb');
        log('ERROR', ' - CentOS/RHEL:   sudo dnf install xorg-x11-server-Xvfb');
        process.exit(1);
    }

    // Найти свободный номер дисплея (начиная с 50, чтобы не конфликтовать с популярными)
    const displayNum = findAvailableDisplay(50);
    log('INFO', `Запуск виртуального дисплея Xvfb (номер дисплея: :${displayNum})...`);

    // Удалить аргумент -xvfb
    const newArgs = originalArgs.filter(arg => arg !== '-xvfb');

    const xvfbArgs = [
        `--server-num=${displayNum}`,
        '--server-args=-ac -screen 0 1366x768x24',
        'env',
        'XVFB_RUNNING=true',
        `DISPLAY=:${displayNum}`,
        process.argv[0],
        process.argv[1],
        ...newArgs
    ];

    const xvfbProcess = spawn('xvfb-run', xvfbArgs, {
        stdio: 'inherit'
    });

    xvfbProcess.on('error', (err) => {
        log('ERROR', `Ошибка запуска Xvfb: ${err.message}`);
        process.exit(1);
    });

    xvfbProcess.on('exit', (code) => {
        process.exit(code || 0);
    });

    // Обработка сигналов завершения
    process.on('SIGINT', () => xvfbProcess.kill('SIGTERM'));
    process.on('SIGTERM', () => xvfbProcess.kill('SIGTERM'));
}

/**
 * Запустить VNC-сервер
 * @param {string} display - номер дисплея
 */
async function startVncServer(display) {
    if (!checkCommand('x11vnc')) {
        log('WARN', 'Команда x11vnc не найдена, запуск VNC пропущен');
        return;
    }

    // Найти свободный VNC-порт (начиная с 5900)
    const vncPort = await findAvailablePort(5900, 100);
    if (!vncPort) {
        log('ERROR', 'Не удалось найти свободный VNC-порт (5900-5999)');
        return;
    }

    log('INFO', `Запуск VNC-сервера (порт: ${vncPort})...`);

    const vncProcess = spawn('x11vnc', [
        '-display', display,
        '-rfbport', String(vncPort),
        '-localhost',
        '-nopw',
        '-shared',
        '-forever',
        '-noxdamage',
        '-norc',
        '-geometry', '1366x768'
    ], {
        stdio: 'ignore',
        detached: false
    });

    vncProcess.on('error', (err) => {
        log('WARN', `Ошибка запуска VNC: ${err.message}`);
        vncInfo.enabled = false;
    });

    vncProcess.on('exit', () => {
        vncInfo.enabled = false;
    });

    // Обновить состояние VNC
    vncInfo.enabled = true;
    vncInfo.port = vncPort;
    vncInfo.display = display;

    log('INFO', `VNC-сервер запущен, порт: ${vncPort}`);

    // Обработка сигналов завершения
    process.on('SIGINT', () => vncProcess.kill('SIGTERM'));
    process.on('SIGTERM', () => vncProcess.kill('SIGTERM'));
}

// ==================== Основная точка входа ====================

async function main() {
    const args = process.argv.slice(2);
    const hasXvfb = args.includes('-xvfb');
    const hasVnc = args.includes('-vnc');
    const isInXvfb = process.env.XVFB_RUNNING === 'true';
    const isLinux = os.platform() === 'linux';

    log('INFO', 'Главный процесс запущен');

    // Обработка аргумента Xvfb (только Linux)
    if (hasXvfb && isLinux && !isInXvfb) {
        startInXvfb(args);
        return;
    }

    // Установить флаг xvfbMode
    vncInfo.xvfbMode = isInXvfb;

    // Если работаем в Xvfb, запустить VNC
    if (isInXvfb && hasVnc) {
        const display = process.env.DISPLAY || ':99';
        await startVncServer(display);
    }

    // Запустить IPC-сервер
    startIpcServer();

    // Запустить дочерний сервис (отфильтровать аргументы -xvfb и -vnc)
    const serverArgs = args.filter(arg => arg !== '-xvfb' && arg !== '-vnc');
    startServer(serverArgs);

    // Обработка сигналов завершения
    process.on('SIGINT', stopAll);
    process.on('SIGTERM', stopAll);
}

main().catch((err) => {
    log('ERROR', `Ошибка запуска: ${err.message}`);
    process.exit(1);
});
