/**
 * @fileoverview Адаптер генерации текста LMArena
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
    gotoWithCheck
} from '../utils/index.js';
import { logger } from '../../utils/logger.js';

// --- Константы конфигурации ---
const TARGET_URL = 'https://arena.ai/text/direct';
const TARGET_URL_SEARCH = 'https://arena.ai/search/direct';

/**
 * Текст ошибки генерации, отображаемый в UI страницы в блоке:
 * <p class="text-interactive-negative text-center text-xs font-medium sm:text-left sm:text-sm">
 * При его обнаружении генерация немедленно прерывается с ошибкой.
 */
const GENERATION_ERROR_TEXT = 'Something went wrong while generating the response. Please try again.';

/**
 * Таймаут ожидания ручного решения CAPTCHA пользователем (10 минут).
 * Когда в ответе API обнаруживается CAPTCHA, адаптер не прерывает работу,
 * а ждёт, пока пользователь решит её вручную, и затем перехватывает повторный запрос фронтенда.
 */
const CAPTCHA_WAIT_TIMEOUT = 10 * 60 * 1000;

/**
 * Выполнение задачи генерации
 * @param {object} context - Контекст браузера { page, client }
 * @param {string} prompt - Промпт (подсказка)
 * @param {string[]} imgPaths - Массив путей к изображениям
 * @param {string} [modelId] - Указанный ID модели (необязательно)
 * @param {object} [meta={}] - Метаданные для логирования
 * @returns {Promise<{image?: string, text?: string, error?: string}>} Результат генерации
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page, config } = context;
    const waitTimeout = config?.backend?.pool?.waitTimeout ?? 120000;
    const textareaSelector = 'textarea';

    // Worker уже проверен, сразу разбираем конфигурацию модели
    const modelConfig = manifest.models.find(m => m.id === modelId);
    const { search } = modelConfig || {};
    const targetUrl = search ? TARGET_URL_SEARCH : TARGET_URL;

    try {
        logger.info('Адаптер', `Открытие новой сессии... (режим поиска: ${!!search})`, meta);
        await gotoWithCheck(page, targetUrl);

        // 1. Ожидание загрузки поля ввода
        await waitForInput(page, textareaSelector, { click: false });

        // 2. Выбор модели
        if (modelId) {
            logger.debug('Адаптер', `Выбор модели: ${modelId}`, meta);
            // Используем клавиатурную навигацию для раскрытия выбора модели: дважды Shift+Tab, затем Enter
            await page.keyboard.down('Shift');
            await page.keyboard.press('Tab');
            await page.keyboard.press('Tab');
            await page.keyboard.up('Shift');
            await sleep(100, 200);
            await page.keyboard.press('Enter');

            // Получаем конфигурацию модели, приоритет у codeName, иначе используем id
            const searchText = modelConfig?.codeName || modelId;

            // Имитируем вставку для ввода имени модели
            await page.evaluate((text) => {
                document.execCommand('insertText', false, text);
            }, searchText);

            // Ожидание завершения фильтрации: первый вариант содержит основной ID целевой модели
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
                // При таймауте продолжаем — возможно, структура списка отличается
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

        // 4. Заполнение промпта
        await safeClick(page, textareaSelector, { bias: 'input' });
        logger.info('Адаптер', 'Ввод промпта...', meta);
        await humanType(page, textareaSelector, prompt);

        // 5. Сначала запускаем прослушивание API
        logger.debug('Адаптер', 'Запуск прослушивания API...', meta);
        const responsePromise = waitApiResponse(page, {
            urlMatch: '/nextjs-api/stream',
            method: 'POST',
            timeout: waitTimeout,
            errorText: GENERATION_ERROR_TEXT,
            meta
        });

        // 6. Отправка промпта
        logger.info('Адаптер', 'Отправка промпта...', meta);
        await safeClick(page, 'button[type="submit"]', { bias: 'button' });

        logger.info('Адаптер', 'Ожидание результата генерации...', meta);

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
        let content = await response.text();

        // 8. Проверка HTTP-ошибок
        const httpError = normalizeHttpError(response, content);
        if (httpError) {
            // Если это CAPTCHA — не прерываемся: ждём ручного решения и перехватываем повторный запрос фронтенда
            if (httpError.error?.toLowerCase().includes('captcha')) {
                logger.warn('Адаптер', 'Обнаружена CAPTCHA — генерация приостановлена. Решите капчу вручную в браузере, после чего выполнение продолжится автоматически (таймаут: 10 мин.)...', meta);
                const retryPromise = waitApiResponse(page, {
                    urlMatch: '/nextjs-api/stream',
                    method: 'POST',
                    timeout: CAPTCHA_WAIT_TIMEOUT,
                    errorText: GENERATION_ERROR_TEXT,
                    meta
                });
                try {
                    response = await retryPromise;
                    content = await response.text();
                } catch (e) {
                    const pageError = normalizePageError(e, meta);
                    if (pageError) return pageError;
                    throw e;
                }
            } else {
                logger.error('Адаптер', `Ошибка при запросе генерации: ${httpError.error}`, meta);
                return { error: `Ошибка при запросе генерации: ${httpError.error}` };
            }
        }

        // 9. Разбор текстового потока
        // Описание формата SSE:
        // - a0: содержимое ответа (финальный текст)
        // - ag: процесс размышления (thinking/reasoning) — только у thinking-моделей
        // - a2: heartbeat (пульс) [{"type":"heartbeat"}]
        // - ad: маркер завершения {"finishReason":"stop"}
        // Пример:
        // ag:"Let me think..."
        // a0:"Hello"
        // a0:" World"
        // ad:{"finishReason":"stop"}
        let fullText = '';
        let thinkingText = '';
        const lines = content.split('\n');

        for (const line of lines) {
            if (line.startsWith('a0:')) {
                try {
                    const textPart = JSON.parse(line.substring(3));
                    fullText += textPart;
                } catch (e) {
                    logger.warn('Адаптер', `Не удалось разобрать текстовый блок: ${line}`, meta);
                }
            } else if (line.startsWith('ag:')) {
                // Содержимое процесса размышления
                try {
                    const thinkPart = JSON.parse(line.substring(3));
                    thinkingText += thinkPart;
                } catch (e) {
                    logger.warn('Адаптер', `Не удалось разобрать блок размышлений: ${line}`, meta);
                }
            }
        }

        if (fullText) {
            logger.info('Адаптер', `Текст успешно получен, длина: ${fullText.length}`, meta);
            const result = { text: fullText };
            // Если есть процесс размышления, добавляем в поле reasoning
            if (thinkingText.trim()) {
                logger.info('Адаптер', `Процесс размышления получен, длина: ${thinkingText.length}`, meta);
                result.reasoning = thinkingText;
            }
            return result;
        } else {
            logger.warn('Адаптер', 'Не удалось извлечь валидное текстовое содержимое', { ...meta, preview: content.substring(0, 150) });
            // Если a0 не разобран, пытаемся вернуть исходное содержимое во избежание пустоты
            return { error: 'Не удалось извлечь валидное текстовое содержимое' };
        }

    } catch (err) {
        // Обработка ошибок верхнего уровня
        const pageError = normalizePageError(err, meta);
        if (pageError) return pageError;

        logger.error('Адаптер', 'Задача генерации завершилась с ошибкой', { ...meta, error: err.message });
        return { error: `Задача генерации завершилась с ошибкой: ${err.message}` };
    } finally { }
}

/**
 * Манифест адаптера
 */
export const manifest = {
    id: 'lmarena_text',
    displayName: 'LMArena (генерация текста)',
    description: 'Использует платформу LMArena для генерации текста, поддерживает множество больших языковых моделей и режим поиска. Требуется авторизованный аккаунт LMArena; без авторизации часто появляется CAPTCHA и действуют ограничения частоты запросов.',

    // URL входной точки
    getTargetUrl(config, workerConfig) {
        return TARGET_URL;
    },

    // Список моделей
    models: [
        // --- Текстовые модели ---
        { id: 'claude-opus-4-6-thinking', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-opus-4-6', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gemini-3-pro', imagePolicy: 'optional', type: 'text' },
        { id: 'gpt-5.2-chat-latest', imagePolicy: 'optional', type: 'text' },
        { id: 'gemini-3-flash', imagePolicy: 'optional', type: 'text' },
        { id: 'grok-4.1-thinking', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-opus-4-5-20251101-thinking-32k', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-opus-4-5-20251101', imagePolicy: 'forbidden', type: 'text' },
        { id: 'grok-4.1', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-sonnet-4-6', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-5.1-high', imagePolicy: 'optional', type: 'text' },
        { id: 'glm-5', imagePolicy: 'forbidden', type: 'text' },
        { id: 'ernie-5.0-0110', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-sonnet-4-5-20250929-thinking-32k', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-sonnet-4-5-20250929', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gemini-2.5-pro', imagePolicy: 'optional', type: 'text' },
        { id: 'ernie-5.0-preview-1203', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-opus-4-1-20250805-thinking-16k', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-opus-4-1-20250805', imagePolicy: 'forbidden', type: 'text' },
        { id: 'glm-4.7', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-5.2-high', imagePolicy: 'optional', type: 'text' },
        { id: 'gpt-5.1', imagePolicy: 'optional', type: 'text' },
        { id: 'gpt-5.2', imagePolicy: 'optional', type: 'text' },
        { id: 'kimi-k2.5-instant', imagePolicy: 'optional', type: 'text' },
        { id: 'qwen3-max-preview', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-5-high', imagePolicy: 'optional', type: 'text' },
        { id: 'o3-2025-04-16', imagePolicy: 'optional', type: 'text' },
        { id: 'grok-4-1-fast-reasoning', imagePolicy: 'forbidden', type: 'text' },
        { id: 'kimi-k2-thinking-turbo', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-5-chat', imagePolicy: 'optional', type: 'text' },
        { id: 'qwen3-max-2025-09-23', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-opus-4-20250514-thinking-16k', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-235b-a22b-instruct-2507', imagePolicy: 'forbidden', type: 'text' },
        { id: 'grok-4-fast-chat', imagePolicy: 'forbidden', type: 'text' },
        { id: 'deepseek-v3.2-thinking', imagePolicy: 'forbidden', type: 'text' },
        { id: 'deepseek-v3.2', imagePolicy: 'forbidden', type: 'text' },
        { id: 'kimi-k2-0905-preview', imagePolicy: 'forbidden', type: 'text' },
        { id: 'kimi-k2-0711-preview', imagePolicy: 'forbidden', type: 'text' },
        { id: 'mistral-large-3', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-vl-235b-a22b-instruct', imagePolicy: 'optional', type: 'text' },
        { id: 'gpt-4.1-2025-04-14', imagePolicy: 'optional', type: 'text' },
        { id: 'claude-opus-4-20250514', imagePolicy: 'forbidden', type: 'text' },
        { id: 'mistral-medium-2508', imagePolicy: 'optional', type: 'text' },
        { id: 'gemini-2.5-flash', imagePolicy: 'optional', type: 'text' },
        { id: 'grok-4-0709', imagePolicy: 'optional', type: 'text' },
        { id: 'claude-haiku-4-5-20251001', imagePolicy: 'forbidden', type: 'text' },
        { id: 'grok-4-fast-reasoning', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-235b-a22b-no-thinking', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-next-80b-a3b-instruct', imagePolicy: 'forbidden', type: 'text' },
        { id: 'longcat-flash-chat', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-sonnet-4-20250514-thinking-32k', imagePolicy: 'forbidden', type: 'text' },
        { id: 'minimax-m2.5', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-235b-a22b-thinking-2507', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-vl-235b-a22b-thinking', imagePolicy: 'optional', type: 'text' },
        { id: 'hunyuan-vision-1.5-thinking', imagePolicy: 'optional', type: 'text' },
        { id: 'o4-mini-2025-04-16', imagePolicy: 'optional', type: 'text' },
        { id: 'step-3.5-flash', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-5-mini-high', imagePolicy: 'optional', type: 'text' },
        { id: 'mimo-v2-flash', imagePolicy: 'forbidden', type: 'text' },
        { id: 'mimo-v2-flash-thinking', codeName: 'mimo-v2-flash (thinking)', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-sonnet-4-20250514', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-3-7-sonnet-20250219-thinking-32k', imagePolicy: 'forbidden', type: 'text' },
        { id: 'hunyuan-t1-20250711', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-coder-480b-a35b-instruct', imagePolicy: 'forbidden', type: 'text' },
        { id: 'minimax-m2.1-preview', imagePolicy: 'forbidden', type: 'text' },
        { id: 'mistral-medium-2505', imagePolicy: 'optional', type: 'text' },
        { id: 'qwen3-30b-a3b-instruct-2507', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-4.1-mini-2025-04-14', imagePolicy: 'optional', type: 'text' },
        { id: 'gemini-2.5-flash-lite-preview-09-2025-no-thinking', imagePolicy: 'optional', type: 'text' },
        { id: 'trinity-large', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-235b-a22b', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-3-5-sonnet-20241022', imagePolicy: 'forbidden', type: 'text' },
        { id: 'claude-3-7-sonnet-20250219', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-next-80b-a3b-thinking', imagePolicy: 'forbidden', type: 'text' },
        { id: 'minimax-m1', imagePolicy: 'forbidden', type: 'text' },
        { id: 'amazon-nova-experimental-chat-11-10', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gemma-3-27b-it', imagePolicy: 'optional', type: 'text' },
        { id: 'grok-3-mini-high', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gemini-2.0-flash-001', imagePolicy: 'optional', type: 'text' },
        { id: 'grok-3-mini-beta', imagePolicy: 'forbidden', type: 'text' },
        { id: 'intellect-3', imagePolicy: 'forbidden', type: 'text' },
        { id: 'mistral-small-2506', imagePolicy: 'optional', type: 'text' },
        { id: 'gpt-oss-120b', imagePolicy: 'forbidden', type: 'text' },
        { id: 'command-a-03-2025', imagePolicy: 'forbidden', type: 'text' },
        { id: 'o3-mini', imagePolicy: 'forbidden', type: 'text' },
        { id: 'minimax-m2', imagePolicy: 'forbidden', type: 'text' },
        { id: 'ling-flash-2.0', imagePolicy: 'forbidden', type: 'text' },
        { id: 'step-3', imagePolicy: 'optional', type: 'text' },
        { id: 'gpt-5-nano-high', imagePolicy: 'optional', type: 'text' },
        { id: 'nova-2-lite', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwq-32b', imagePolicy: 'forbidden', type: 'text' },
        { id: 'olmo-3.1-32b-instruct', imagePolicy: 'forbidden', type: 'text' },
        { id: 'molmo-2-8b', imagePolicy: 'optional', type: 'text' },
        { id: 'qwen3-30b-a3b', imagePolicy: 'forbidden', type: 'text' },
        { id: 'ring-flash-2.0', imagePolicy: 'forbidden', type: 'text' },
        { id: 'llama-3.3-70b-instruct', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gemma-3n-e4b-it', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gpt-oss-20b', imagePolicy: 'forbidden', type: 'text' },
        { id: 'nvidia-nemotron-3-nano-30b-a3b-bf16', imagePolicy: 'forbidden', type: 'text' },
        { id: 'mercury', imagePolicy: 'forbidden', type: 'text' },
        { id: 'olmo-3-32b-think', imagePolicy: 'forbidden', type: 'text' },
        { id: 'mistral-small-3.1-24b-instruct-2503', imagePolicy: 'optional', type: 'text' },
        { id: 'ibm-granite-h-small', imagePolicy: 'forbidden', type: 'text' },
        { id: 'olmo-3.1-32b-think', imagePolicy: 'forbidden', type: 'text' },
        { id: 'ling-2.5-1t', imagePolicy: 'forbidden', type: 'text' },
        { id: 'ring-2.5-1t', imagePolicy: 'forbidden', type: 'text' },
        { id: 'seed-1.8', imagePolicy: 'optional', type: 'text' },
        { id: 'dola-seed-2.0-preview-vision', imagePolicy: 'optional', type: 'text' },
        { id: 'grok-4-1-fast-non-reasoning', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3.5-27b', imagePolicy: 'forbidden', type: 'text' },
        { id: 'amazon.nova-pro-v1:0', imagePolicy: 'optional', type: 'text' },
        { id: 'qwen3.5-35b-a3b', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3.5-122b-a10b', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3.5-397b-a17b', imagePolicy: 'forbidden', type: 'text' },
        { id: 'amazon-nova-experimental-chat-12-10', imagePolicy: 'forbidden', type: 'text' },
        { id: 'grok-4.20-beta1', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gemini-3.1-pro-preview', imagePolicy: 'optional', type: 'text' },
        { id: 'gpt-5-high-new-system-prompt', imagePolicy: 'optional', type: 'text' },
        { id: 'qwen3-vl-8b-thinking', imagePolicy: 'optional', type: 'text' },
        { id: 'qwen3-vl-8b-instruct', imagePolicy: 'optional', type: 'text' },
        { id: 'glm-4.7-flash', imagePolicy: 'forbidden', type: 'text' },
        { id: 'gemini-3-flash-thinking-minimal', codeName: 'gemini-3-flash (thinking-minimal)', imagePolicy: 'optional', type: 'text' },
        { id: 'kimi-k2.5-thinking', imagePolicy: 'optional', type: 'text' },
        { id: 'dola-seed-2.0-preview-text', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-max-2025-09-26', imagePolicy: 'forbidden', type: 'text' },
        { id: 'ernie-5.0-preview-1220', imagePolicy: 'optional', type: 'text' },
        { id: 'qwen3-omni-flash', imagePolicy: 'optional', type: 'text' },
        { id: 'qwen-vl-max-2025-08-13', imagePolicy: 'optional', type: 'text' },
        { id: 'minimax-m2-preview', imagePolicy: 'forbidden', type: 'text' },
        { id: 'qwen3-max-thinking', imagePolicy: 'forbidden', type: 'text' },

        // --- Модели поиска ---
        { id: 'grok-4.20-beta1', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'gpt-5.2-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'gemini-3-flash-grounding', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'gemini-3-pro-grounding', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'gpt-5.1-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'gpt-5.2-search-non-reasoning', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'grok-4-1-fast-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'grok-4-fast-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'claude-opus-4-5-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'o3-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'gemini-2.5-pro-grounding', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'grok-4-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'ppl-sonar-reasoning-pro-high', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'claude-opus-4-1-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'claude-sonnet-4-5-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'gpt-5-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'claude-opus-4-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'claude-opus-4-6-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'claude-sonnet-4-6-search', imagePolicy: 'forbidden', type: 'text', search: true },
        { id: 'gpt-5.1-search-sp', imagePolicy: 'forbidden', type: 'text', search: true },
    ],

    // Обработчики навигации не требуются
    navigationHandlers: [],

    // Основной метод генерации
    generate
};
