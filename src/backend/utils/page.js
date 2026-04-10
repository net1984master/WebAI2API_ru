/**
 * @fileoverview Утилиты взаимодействия со страницей
 * @description Блокировка аутентификации страницы, ожидание полей ввода, отправка форм и другие операции на уровне страницы
 */

import { sleep, safeClick, isPageValid, createPageCloseWatcher, getRealViewport, clamp, random } from '../engine/utils.js';
import { TIMEOUTS } from '../../utils/constants.js';

// ==========================================
// Блокировка аутентификации страницы
// ==========================================

/**
 * Ожидание завершения аутентификации страницы
 * @param {import('playwright-core').Page} page - Объект страницы
 */
export async function waitForPageAuth(page) {
    while (page.authState?.isHandlingAuth) {
        await sleep(500, 1000);
    }
}

/**
 * Установить блокировку аутентификации страницы (заблокировать)
 * @param {import('playwright-core').Page} page - Объект страницы
 */
export function lockPageAuth(page) {
    if (page.authState) page.authState.isHandlingAuth = true;
}

/**
 * Снять блокировку аутентификации страницы (разблокировать)
 * @param {import('playwright-core').Page} page - Объект страницы
 */
export function unlockPageAuth(page) {
    if (page.authState) page.authState.isHandlingAuth = false;
}

/**
 * Проверить, обрабатывается ли аутентификация страницы в данный момент
 * @param {import('playwright-core').Page} page - Объект страницы
 * @returns {boolean}
 */
export function isPageAuthLocked(page) {
    return page.authState?.isHandlingAuth === true;
}

// ==========================================
// Поля ввода и формы
// ==========================================

/**
 * Ожидание появления поля ввода (с автоматическим ожиданием завершения аутентификации)
 * @param {import('playwright-core').Page} page - Объект страницы
 * @param {string|import('playwright-core').Locator} selectorOrLocator - Селектор поля ввода или объект Locator
 * @param {object} [options={}] - Параметры
 * @param {number} [options.timeout=60000] - Таймаут (в миллисекундах)
 * @param {boolean} [options.click=true] - Кликнуть ли по полю ввода после его обнаружения
 * @returns {Promise<void>}
 */
export async function waitForInput(page, selectorOrLocator, options = {}) {
    const { timeout = TIMEOUTS.INPUT_WAIT, click = true } = options;

    const isLocator = typeof selectorOrLocator !== 'string';
    const displayName = isLocator ? 'Locator' : selectorOrLocator;
    const startTime = Date.now();

    // Ожидание завершения аутентификации
    while (isPageAuthLocked(page)) {
        if (Date.now() - startTime >= timeout) break;
        await sleep(500, 1000);
    }

    // Вычисление оставшегося времени таймаута
    const elapsed = Date.now() - startTime;
    const remainingTimeout = Math.max(timeout - elapsed, 5000);

    // Ожидание появления поля ввода
    if (isLocator) {
        await selectorOrLocator.first().waitFor({ state: 'visible', timeout: remainingTimeout }).catch(() => {
            throw new Error(`Поле ввода не найдено (${displayName})`);
        });
    } else {
        await page.waitForSelector(selectorOrLocator, { timeout: remainingTimeout }).catch(() => {
            throw new Error(`Поле ввода не найдено (${displayName})`);
        });
    }

    if (click) {
        await safeClick(page, selectorOrLocator, { bias: 'input' });
        await sleep(500, 1000);
    }
}

// ==========================================
// Навигация и мышь
// ==========================================

/**
 * Перейти по указанному URL и проверить HTTP-ошибки
 * @param {import('playwright-core').Page} page - Объект страницы
 * @param {string} url - Целевой URL
 * @param {object} [options={}] - Параметры
 * @param {number} [options.timeout=30000] - Таймаут (в миллисекундах)
 * @throws {Error} Выбрасывает ошибку при неудачной навигации
 */
export async function gotoWithCheck(page, url, options = {}) {
    const { timeout = TIMEOUTS.NAVIGATION } = options;
    try {
        const response = await page.goto(url, {
            waitUntil: 'load',
            timeout
        });
        if (!response) {
            throw new Error('Страница недоступна. Не удалось загрузить страницу: нет ответа');
        }
        const status = response.status();
        if (status >= 400) {
            throw new Error(`Сайт недоступен (HTTP ${status})`);
        }
    } catch (e) {
        if (e.message.includes('Timeout')) {
            throw new Error('Превышено время загрузки страницы');
        }
        // Если это наша собственная ошибка — пробрасываем как есть
        if (e.message.startsWith('Страница') || e.message.startsWith('Сайт') || e.message.startsWith('页面') || e.message.startsWith('网站')) {
            throw e;
        }
        throw new Error(`Не удалось загрузить страницу: ${e.message}`);
    }
}

/**
 * Попытка перехода по URL (версия без выбрасывания исключений, для сценариев, где нужно собирать ошибки)
 * @param {import('playwright-core').Page} page - Объект страницы
 * @param {string} url - Целевой URL
 * @param {object} [options={}] - Параметры
 * @returns {Promise<{success?: boolean, error?: string}>}
 */
export async function tryGotoWithCheck(page, url, options = {}) {
    try {
        await gotoWithCheck(page, url, options);
        return { success: true };
    } catch (e) {
        return { error: e.message };
    }
}

/**
 * Ожидание появления элемента и прокрутка до видимой области
 * @param {import('playwright-core').Page} page - Объект страницы Playwright
 * @param {string|import('playwright-core').Locator} selectorOrLocator - CSS-селектор или объект Locator
 * @param {object} [options={}] - Параметры
 * @param {number} [options.timeout=30000] - Таймаут (в миллисекундах)
 * @returns {Promise<import('playwright-core').ElementHandle|null>} Дескриптор элемента, при неудаче возвращает null
 */
export async function scrollToElement(page, selectorOrLocator, options = {}) {
    const { timeout = TIMEOUTS.ELEMENT_SCROLL } = options;
    try {
        const isLocator = typeof selectorOrLocator !== 'string';
        let element;

        if (isLocator) {
            // Объект Locator (getByRole, getByText и т.д.)
            await selectorOrLocator.first().waitFor({ timeout, state: 'attached' });
            element = await selectorOrLocator.first().elementHandle();
        } else {
            // Строка CSS-селектора
            element = await page.waitForSelector(selectorOrLocator, { timeout, state: 'attached' });
        }

        if (element) {
            await element.scrollIntoViewIfNeeded();
            return element;
        }
    } catch {
        // Элемент не найден или превышен таймаут
    }
    return null;
}


/**
 * Ожидание API-ответа (с отслеживанием закрытия страницы и обнаружением ключевых слов ошибок)
 * После сопоставления ответа ожидает завершения запроса (requestfinished), с защитой по таймауту простоя 60 секунд
 * @param {import('playwright-core').Page} page - Объект страницы Playwright
 * @param {object} options - Параметры ожидания
 * @param {string} options.urlMatch - Строка для сопоставления URL
 * @param {string|string[]} [options.urlContains] - URL должен дополнительно содержать эту строку (необязательно, может быть массивом)
 * @param {string} [options.method='POST'] - HTTP-метод
 * @param {number} [options.timeout=120000] - Таймаут ожидания появления ответа (в миллисекундах)
 * @param {string|string[]} [options.errorText] - Ключевые слова ошибок: при их появлении в UI страницы или теле API-ответа немедленно останавливается и возвращается ошибка
 * @param {object} [options.meta={}] - Метаданные для логирования
 * @returns {Promise<import('playwright-core').Response>} Объект ответа
 */
export function waitApiResponse(page, options = {}) {
    const promise = (async () => {
        const {
            urlMatch,
            urlContains,
            method = 'POST',
            timeout = TIMEOUTS.API_RESPONSE,
            errorText,
            meta = {}
        } = options;

        if (!isPageValid(page)) {
            throw new Error('PAGE_INVALID');
        }

        const pageWatcher = createPageCloseWatcher(page);
        const patterns = errorText ? (Array.isArray(errorText) ? errorText : [errorText]) : [];

        // Обнаружение ключевых слов ошибок в UI страницы
        let uiErrorPromise = null;
        if (patterns.length > 0) {
            let combinedLocator = null;
            for (const pattern of patterns) {
                const loc = page.getByText(pattern);
                combinedLocator = combinedLocator ? combinedLocator.or(loc) : loc;
            }
            if (combinedLocator) {
                uiErrorPromise = combinedLocator.first().waitFor({ timeout, state: 'attached' })
                    .then(async () => {
                        const matchedText = await combinedLocator.first().textContent().catch(() => 'Неизвестная ошибка');
                        throw new Error(`PAGE_ERROR_DETECTED: ${matchedText}`);
                    });
            }
        }

        // Управление таймаутом
        let timerId = null;
        let responseHandler = null;

        const cleanup = () => {
            if (timerId) clearTimeout(timerId);
            if (responseHandler) page.off('response', responseHandler);
            pageWatcher.cleanup();
        };

        try {
            const responsePromise = new Promise((resolve, reject) => {
                // Таймер таймаута (сбрасываетс�� при получении данных потокового ответа)
                const resetTimer = () => {
                    if (timerId) clearTimeout(timerId);
                    timerId = setTimeout(() => {
                        reject(new Error(`API_TIMEOUT: Превышено время ожидания ответа (${Math.round(timeout / 1000)} сек.)`));
                    }, timeout);
                };

                // Запуск начального таймаута
                resetTimer();

                // Прослушивание ответов
                responseHandler = async (res) => {
                    const url = res.url();

                    // Базовое сопоставление
                    if (!url.includes(urlMatch)) return;

                    // Дополнительная проверка содержимого URL
                    if (urlContains) {
                        const containsArray = Array.isArray(urlContains) ? urlContains : [urlContains];
                        if (!containsArray.every(str => url.includes(str))) return;
                    }

                    // Проверка метода и статуса
                    const reqMethod = res.request().method();
                    const status = res.status();
                    if (reqMethod !== method || (status !== 200 && status < 400)) return;

                    // Успешное сопоставление, удаление обработчика (обрабатывается только первый совпавший ответ)
                    page.off('response', responseHandler);
                    responseHandler = null;

                    // Единое ожидание завершения запроса (как для потоковых, так и для обычных ответов)
                    // Используется timeout как таймаут простоя для предотвращения бесконечного ожидания при зависшем соединении
                    let idleTimerId = null;

                    // Отмена начального таймаута, запуск таймаута простоя
                    if (timerId) {
                        clearTimeout(timerId);
                        timerId = null;
                    }

                    idleTimerId = setTimeout(() => {
                        page.off('requestfinished', finishedHandler);
                        page.off('requestfailed', failedHandler);
                        reject(new Error(`API_TIMEOUT: Превышено время передачи ответа (не завершено за ${Math.round(timeout / 1000)} сек.)`));
                    }, timeout);

                    const request = res.request();

                    const finishedHandler = (req) => {
                        if (req === request) {
                            if (idleTimerId) clearTimeout(idleTimerId);
                            page.off('requestfinished', finishedHandler);
                            page.off('requestfailed', failedHandler);
                            resolve(res);
                        }
                    };

                    const failedHandler = (req) => {
                        if (req === request) {
                            if (idleTimerId) clearTimeout(idleTimerId);
                            page.off('requestfinished', finishedHandler);
                            page.off('requestfailed', failedHandler);
                            reject(new Error('NETWORK_FAILED: Запрос не выполнен'));
                        }
                    };

                    page.on('requestfinished', finishedHandler);
                    page.on('requestfailed', failedHandler);
                };

                page.on('response', responseHandler);
            });

            const promises = [responsePromise, pageWatcher.promise];
            if (uiErrorPromise) promises.push(uiErrorPromise);

            const response = await Promise.race(promises);

            // Обнаружение ключевых слов ошибок в теле API-ответа (синхронная проверка перед возвратом)
            if (patterns.length > 0) {
                try {
                    const bodyBuffer = await response.body();
                    const body = bodyBuffer.toString('utf-8');
                    for (const pattern of patterns) {
                        const keyword = typeof pattern === 'string' ? pattern : pattern.source;
                        if (body.includes(keyword)) {
                            throw new Error(`API_ERROR_DETECTED: ${keyword}`);
                        }
                    }
                    // Возврат прокси-объекта с кэшированным телом для поддержки повторного чтения вызывающей стороной
                    const cachedResponse = Object.create(response);
                    cachedResponse.text = async () => body;
                    cachedResponse.json = async () => JSON.parse(body);
                    cachedResponse.body = async () => bodyBuffer;
                    return cachedResponse;
                } catch (e) {
                    if (e.message.startsWith('API_ERROR_DETECTED')) throw e;
                }
            }

            return response;
        } catch (e) {
            // Обнаружение ошибки таймаута, преобразование в стандартный тип ошибки
            if (e.name === 'TimeoutError' || e.message?.includes('TIMEOUT')) {
                throw new Error(`API_TIMEOUT: ${e.message}`);
            }
            throw e;
        } finally {
            cleanup();
        }
    })();

    // Критическое исправление: добавление пустого обработчика catch
    // Потому что адаптеры обычно сначала вызывают waitApiResponse для получения Promise, затем выполняют safeClick, и только потом делают await
    // Если во время safeClick страница закроется/упадёт, этот Promise будет отклонён, что вызовет аварийное завершение Node.js из-за необработанного исключения
    promise.catch(() => {});

    return promise;
}

