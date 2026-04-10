/**
 * @fileoverview Адаптер генерации изображений LMArena
 */

import {
    sleep,
    humanType,
    safeClick,
    pasteImages
} from '../engine/utils.js';
import {
    waitApiResponse,
    normalizePageError,
    normalizeHttpError,
    waitForInput,
    gotoWithCheck,
    useContextDownload
} from '../utils/index.js';
import { logger } from '../../utils/logger.js';

// --- Константы конфигурации ---
const TARGET_URL = 'https://arena.ai/image/direct';

/**
 * Извлекает URL изображения из текста ответа
 * @param {string} text - Текстовое содержимое ответа
 * @returns {string|null} Извлечённый URL изображения или null, если не найден
 */
function extractImage(text) {
    if (!text) return null;
    const lines = text.split('\n');
    for (const line of lines) {
        if (line.startsWith('a2:')) {
            try {
                const data = JSON.parse(line.substring(3));
                if (data?.[0]?.image) return data[0].image;
            } catch (e) { }
        }
    }
    return null;
}

/**
 * Извлекает сообщение об ошибке из текста ответа
 * Форматы SSE-ошибок:
 * - a3: ошибка от провайдера модели (например, OpenAI moderation_blocked)
 * - ae: ошибка платформы Arena (например, блокировка модерацией контента)
 * @param {string} text - Текстовое содержимое ответа
 * @returns {string|null} Извлечённое сообщение об ошибке или null, если не найдено
 */
function extractError(text) {
    if (!text) return null;
    const lines = text.split('\n');
    for (const line of lines) {
        // a3: ошибка от провайдера модели
        if (line.startsWith('a3:')) {
            try {
                const errorMsg = JSON.parse(line.substring(3));
                if (typeof errorMsg === 'string') {
                    // Попытка извлечь вложенную JSON-ошибку
                    const jsonMatch = errorMsg.match(/\{[\s\S]*"error"[\s\S]*\}/);
                    if (jsonMatch) {
                        try {
                            const nested = JSON.parse(jsonMatch[0]);
                            if (nested.error?.message) {
                                return `[Ошибка модели] ${nested.error.message} (code: ${nested.error.code || 'unknown'})`;
                            }
                        } catch { }
                    }
                    return `[Ошибка модели] ${errorMsg}`;
                }
            } catch (e) { }
        }
        // ae: ошибка платформы Arena
        if (line.startsWith('ae:')) {
            try {
                const errorData = JSON.parse(line.substring(3));
                if (errorData?.message) {
                    return `[Ошибка платформы] ${errorData.message}`;
                }
                if (typeof errorData === 'string') {
                    return `[Ошибка платформы] ${errorData}`;
                }
            } catch (e) { }
        }
    }
    return null;
}


/**
 * Выполняет задачу генерации изображения
 * @param {object} context - Контекст браузера { page, client }
 * @param {string} prompt - Промпт (текстовое описание)
 * @param {string[]} imgPaths - Массив путей к изображениям
 * @param {string} [modelId] - Указанный ID модели (необязательно)
 * @param {object} [meta={}] - Метаданные для логирования
 * @returns {Promise<{image?: string, text?: string, error?: string}>} Результат генерации
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page, config } = context;
    const waitTimeout = config?.backend?.pool?.waitTimeout ?? 120000;
    const textareaSelector = 'textarea';

    try {
        logger.info('Адаптер', 'Начинаем новую сессию...', meta);
        await gotoWithCheck(page, TARGET_URL);

        // 1. Ожидание загрузки поля ввода
        await waitForInput(page, textareaSelector, { click: true });

        // 2. Выбор модели
        if (modelId) {
            logger.debug('Адаптер', `Выбор модели: ${modelId}`, meta);
            // Используем навигацию с клавиатуры для раскрытия списка моделей: два раза Shift+Tab, затем Enter
            await page.keyboard.down('Shift');
            await page.keyboard.press('Tab');
            await page.keyboard.press('Tab');
            await page.keyboard.up('Shift');
            await sleep(100, 200);
            await page.keyboard.press('Enter');

            // Получаем конфигурацию модели, приоритет у codeName, иначе используем id
            const modelConfig = manifest.models.find(m => m.id === modelId);
            const searchText = modelConfig?.codeName || modelId;

            // Имитируем вставку названия модели
            await page.evaluate((text) => {
                document.execCommand('insertText', false, text);
            }, searchText);

            // Ожидаем завершения фильтрации: первый вариант содержит основной ID целевой модели
            // searchText может быть codeName (с пояснением в скобках), но отфильтрованный вариант должен содержать modelId
            try {
                await page.waitForFunction(
                    (targetId) => {
                        const firstOption = document.querySelector('[role="option"]');
                        return firstOption && firstOption.textContent?.includes(targetId);
                    },
                    modelId,
                    { timeout: 5000 }
                );
            } catch {
                // При таймауте продолжаем — возможно, структура списка другая
                logger.debug('Адаптер', `Таймаут ожидания фильтрации вариантов модели, продолжаем выполнение`, meta);
            }
            await sleep(300, 500);
            await page.keyboard.press('Enter');
        }

        // 3. Загрузка изображений
        if (imgPaths && imgPaths.length > 0) {
            logger.info('Адаптер', `Начинаем загрузку ${imgPaths.length} изображений`, meta);
            await pasteImages(page, textareaSelector, imgPaths, {}, meta);
            logger.info('Адаптер', 'Загрузка изображений завершена', meta);
        }

        // 4. Ввод промпта
        await safeClick(page, textareaSelector, { bias: 'input' });
        logger.info('Адаптер', 'Вводим промпт...', meta);
        await humanType(page, textareaSelector, prompt);

        // 5. Сначала запускаем прослушивание API
        logger.debug('Адаптер', 'Запускаем прослушивание API...', meta);
        const responsePromise = waitApiResponse(page, {
            urlMatch: '/nextjs-api/stream',
            method: 'POST',
            timeout: waitTimeout,
            meta
        });

        // 6. Отправка промпта
        logger.info('Адаптер', 'Отправляем промпт...', meta);
        await safeClick(page, 'button[type="submit"]', { bias: 'button' });

        logger.info('Адаптер', 'Ожидаем результат генерации...', meta);

        // 7. Ожидание ответа API
        let response;
        try {
            response = await responsePromise;
        } catch (e) {
            // Используем общую обработку ошибок
            const pageError = normalizePageError(e, meta);
            if (pageError) return pageError;
            throw e;
        }

        // 7. Разбор результата ответа
        const content = await response.text();

        // 8. Проверка HTTP-ошибок
        const httpError = normalizeHttpError(response, content);
        if (httpError) {
            logger.error('Адаптер', `Ошибка при запросе генерации: ${httpError.error}`, meta);
            return { error: `Ошибка при запросе генерации: ${httpError.error}`, retryable: httpError.retryable };
        }

        // 8.5 Проверка SSE-ошибок (строки a3/ae)
        const sseError = extractError(content);
        if (sseError) {
            logger.warn('Адаптер', `SSE-ошибка: ${sseError}`, meta);
            return { error: sseError, retryable: false };
        }

        // 9. Извлечение URL изображения
        const img = extractImage(content);
        if (img) {
            // Проверяем, настроен ли возврат URL
            const returnUrl = config?.backend?.adapter?.lmarena?.returnUrl || false;
            if (returnUrl) {
                logger.info('Адаптер', 'Результат получен, возвращаем URL', meta);
                return { image: img };
            }

            logger.info('Адаптер', 'Результат получен, скачиваем изображение...', meta);
            const imgDlCfg = config?.backend?.pool?.failover || {};
            const result = await useContextDownload(img, page, {
                retries: imgDlCfg.imgDlRetry ? (imgDlCfg.imgDlRetryMaxRetries || 2) : 0
            });
            if (result.image) {
                logger.info('Адаптер', 'Изображение скачано, задача завершена', meta);
            }
            return result;
        } else {
            logger.warn('Адаптер', 'Результат не получен, в ответе нет данных изображения', { ...meta, preview: content.substring(0, 150) });
            return { error: `Результат не получен, в ответе нет данных изображения: ${content.substring(0, 200)}` };
        }

    } catch (err) {
        // Обработка ошибок верхнего уровня
        const pageError = normalizePageError(err, meta);
        if (pageError) return pageError;

        logger.error('Адаптер', 'Задача генерации не выполнена', { ...meta, error: err.message });
        return { error: `Задача генерации не выполнена: ${err.message}` };
    } finally { }
}

/**
 * Манифест адаптера
 */
export const manifest = {
    id: 'lmarena',
    displayName: 'LMArena (генерация изображений)',
    description: 'Генерация изображений с помощью платформы LMArena, поддержка множества моделей генерации изображений. Требуется авторизованный аккаунт LMArena; без авторизации часто появляется капча и действует ограничение частоты запросов.',

    // Схема параметров конфигурации
    configSchema: [
        {
            key: 'returnUrl',
            label: 'Возвращать URL изображения',
            type: 'boolean',
            default: false,
            note: 'При включении возвращается URL изображения напрямую (но другие адаптеры, не поддерживающие эту опцию, по-прежнему будут возвращать Base64)'
        }
    ],

    // Целевой URL
    getTargetUrl(config, workerConfig) {
        return TARGET_URL;
    },

    // Список моделей
    models: [
        { id: 'gemini-3.1-flash-image-preview', codeName: 'gemini-3.1-flash-image-preview (nano-banana-2) [web-search]', imagePolicy: 'optional' },
        { id: 'gpt-image-1.5-high-fidelity', imagePolicy: 'optional' },
        { id: 'gemini-3-pro-image-preview-2k', codeName: 'gemini-3-pro-image-preview-2k (nano-banana-pro)', imagePolicy: 'optional' },
        { id: 'flux-2-max', imagePolicy: 'optional' },
        { id: 'flux-2-flex', imagePolicy: 'optional' },
        { id: 'flux-2-pro', imagePolicy: 'optional' },
        { id: 'hunyuan-image-3.0', imagePolicy: 'forbidden' },
        { id: 'flux-2-dev', imagePolicy: 'optional' },
        { id: 'seedream-4.5', imagePolicy: 'optional' },
        { id: 'qwen-image-2512', imagePolicy: 'forbidden' },
        { id: 'imagen-4.0-generate-001', imagePolicy: 'forbidden' },
        { id: 'wan2.5-t2i-preview', imagePolicy: 'forbidden' },
        { id: 'gpt-image-1', imagePolicy: 'optional' },
        { id: 'seedream-4-high-res-fal', imagePolicy: 'optional' },
        { id: 'seedream-5.0-lite', imagePolicy: 'optional' },
        { id: 'gpt-image-1-mini', imagePolicy: 'optional' },
        { id: 'recraft-v4', imagePolicy: 'forbidden' },
        { id: 'mai-image-1', imagePolicy: 'forbidden' },
        { id: 'seedream-3', imagePolicy: 'forbidden' },
        { id: 'flux-2-klein-9b', imagePolicy: 'optional' },
        { id: 'qwen-image-prompt-extend', imagePolicy: 'forbidden' },
        { id: 'flux-1-kontext-pro', imagePolicy: 'optional' },
        { id: 'imagen-3.0-generate-002', imagePolicy: 'forbidden' },
        { id: 'ideogram-v3-quality', imagePolicy: 'forbidden' },
        { id: 'p-image', imagePolicy: 'forbidden' },
        { id: 'photon', imagePolicy: 'forbidden' },
        { id: 'recraft-v3', imagePolicy: 'forbidden' },
        { id: 'flux-2-klein-4b', imagePolicy: 'optional' },
        { id: 'lucid-origin', imagePolicy: 'forbidden' },
        { id: 'dall-e-3', imagePolicy: 'forbidden' },
        { id: 'flux-1-kontext-dev', imagePolicy: 'optional' },
        { id: 'imagen-4.0-ultra-generate-001', imagePolicy: 'forbidden' },
        { id: 'p-image-edit', imagePolicy: 'required' },
        { id: 'hunyuan-image-2.1', imagePolicy: 'forbidden' },
        { id: 'reve-v1.1', imagePolicy: 'required' },
        { id: 'vidu-q2-image', imagePolicy: 'optional' },
        { id: 'imagen-4.0-fast-generate-001', imagePolicy: 'forbidden' },
        { id: 'reve-v1.1-fast', imagePolicy: 'required' },
        { id: 'chatgpt-image-latest-high-fidelity', codeName: 'chatgpt-image-latest-high-fidelity (20251216)', imagePolicy: 'required' },
        { id: 'hunyuan-image-3.0-instruct', imagePolicy: 'required' },
        { id: 'grok-imagine-image', imagePolicy: 'forbidden' },
        { id: 'grok-imagine-image-pro', imagePolicy: 'forbidden' },
        { id: 'gemini-2.5-flash-image-preview', codeName: 'gemini-2.5-flash-image-preview (nano-banana)', imagePolicy: 'optional' },
        { id: 'qwen-image-edit-2511', imagePolicy: 'required' },
        { id: 'wan2.5-i2i-preview', imagePolicy: 'required' },
        { id: 'qwen-image-edit', imagePolicy: 'required' },
        { id: 'wan2.6-image', imagePolicy: 'required' },
        { id: 'seededit-3.0', imagePolicy: 'required' },
        { id: 'wan2.6-t2i', imagePolicy: 'forbidden' },
    ],

    // Обработчики навигации не требуются
    navigationHandlers: [],

    // Основной метод генерации изображений
    generate
};
