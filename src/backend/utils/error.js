/**
 * @fileoverview Модуль нормализации ошибок
 * @description Единая обработка ошибок на уровне страницы и HTTP с определением возможности повторной попытки
 */

import { logger } from '../../utils/logger.js';
import { ADAPTER_ERRORS } from '../../server/errors.js';

// ==========================================
// Проверка на возможность повторной попытки
// ==========================================

/**
 * Определяет, можно ли повторить ошибку
 * @param {string} errorMessage - Сообщение об ошибке
 * @returns {boolean}
 */
export function isRetryableError(errorMessage) {
    if (!errorMessage) return false;

    const retryablePatterns = [
        // Сетевые ошибки
        /network|net::|econnreset|econnrefused|etimedout/i,
        // Тайм-ауты
        /timeout|timed out|加载超时|请求超时|тайм[- ]?аут|время ожидания/i,
        // Сбой страницы
        /crashed|crash|сбой|аварийн/i,
        // Ошибки сервера 5xx
        /5\d{2}|internal server error|bad gateway|service unavailable|ошибка сервера/i,
        // Ограничение частоты запросов (может быть временным)
        /rate limit|too many requests|429|слишком много запросов|лимит запросов/i,
    ];

    return retryablePatterns.some(pattern => pattern.test(errorMessage));
}

// ==========================================
// Нормализация ошибок страницы
// ==========================================

/**
 * Единая обработка ошибок уровня страницы
 * @param {Error} err - Исходная ошибка
 * @param {object} [meta={}] - Метаданные для логов
 * @returns {{ error: string, code: string, retryable: boolean } | null}
 */
export function normalizePageError(err, meta = {}) {
    if (err.message === 'PAGE_CLOSED') {
        logger.error('Адаптер', 'Страница закрыта', meta);
        return { error: 'Страница закрыта, не обновляйте страницу во время генерации изображения', code: ADAPTER_ERRORS.PAGE_CLOSED, retryable: true };
    }
    if (err.message === 'PAGE_CRASHED') {
        logger.error('Адаптер', 'Страница аварийно завершила работу', meta);
        return { error: 'Страница аварийно завершила работу, попробуйте ещё раз', code: ADAPTER_ERRORS.PAGE_CRASHED, retryable: true };
    }
    if (err.message === 'PAGE_INVALID') {
        logger.error('Адаптер', 'Недопустимое состояние страницы', meta);
        return { error: 'Недопустимое состояние страницы, выполните повторную инициализацию', code: ADAPTER_ERRORS.PAGE_INVALID, retryable: true };
    }
    // API_TIMEOUT: ошибка тайм-аута, преобразованная внутри waitApiResponse
    if (err.message?.startsWith('API_TIMEOUT:')) {
        const timeoutMsg = err.message.replace('API_TIMEOUT: ', '');
        logger.error('Адаптер', timeoutMsg, meta);
        return { error: timeoutMsg, code: ADAPTER_ERRORS.TIMEOUT_ERROR, retryable: true };
    }
    // Тайм-аут загрузки страницы (ошибка тайм-аута, выброшенная gotoWithCheck)
    if (
        err.message?.includes('页面加载超时') ||
        err.message?.includes('页面加载失败') ||
        err.message?.includes('Тайм-аут загрузки страницы') ||
        err.message?.includes('Ошибка загрузки страницы')
    ) {
        logger.error('Адаптер', err.message, meta);
        return { error: 'Ошибка загрузки страницы', code: ADAPTER_ERRORS.TIMEOUT_ERROR, retryable: true };
    }
    // Совместимость с нативным TimeoutError (выброшенным в других местах)
    if (err.name === 'TimeoutError' || err.message?.includes('Timeout')) {
        logger.error('Адаптер', 'Запрос превысил время ожидания', meta);
        return { error: 'Запрос превысил время ожидания, проверьте сеть или попробуйте позже', code: ADAPTER_ERRORS.TIMEOUT_ERROR, retryable: true };
    }
    // PAGE_ERROR_DETECTED: ключевое слово ошибки, обнаруженное в UI страницы внутри waitApiResponse
    if (err.message?.startsWith('PAGE_ERROR_DETECTED:')) {
        const keyword = err.message.replace('PAGE_ERROR_DETECTED: ', '');
        logger.error('Адаптер', `На странице обнаружена ошибка: ${keyword}`, meta);
        return { error: `Контент заблокирован: ${keyword}`, code: ADAPTER_ERRORS.CONTENT_BLOCKED, retryable: false };
    }
    // API_ERROR_DETECTED: ключевое слово ошибки, обнаруженное в теле API-ответа внутри waitApiResponse
    if (err.message?.startsWith('API_ERROR_DETECTED:')) {
        const keyword = err.message.replace('API_ERROR_DETECTED: ', '');
        logger.error('Адаптер', `В API-ответе обнаружена ошибка: ${keyword}`, meta);
        return { error: `Контент заблокирован: ${keyword}`, code: ADAPTER_ERRORS.CONTENT_BLOCKED, retryable: false };
    }
    return null;
}

// ==========================================
// Нормализация HTTP-ошибок
// ==========================================

/**
 * Единая обработка ошибок HTTP-ответа
 * @param {import('playwright-core').Response} response - Объект HTTP-ответа
 * @param {string} [content=null] - Содержимое ответа (необязательно)
 * @returns {{ error: string, code: string, retryable: boolean } | null}
 */
export function normalizeHttpError(response, content = null) {
    const status = response.status();

    // Попытаться извлечь конкретную информацию об ошибке из тела ответа
    let detailError = null;
    if (content) {
        try {
            const json = JSON.parse(content);
            // Формат: {"error": "Request rejected: ..."}
            if (json.error && typeof json.error === 'string') {
                detailError = json.error;
            }
            // Формат: {"error": {"message": "..."}}
            else if (json.error?.message) {
                detailError = json.error.message;
            }
        } catch {
            // Не JSON-формат, попробуем использовать содержимое напрямую
            if (content.length < 200) {
                detailError = content;
            }
        }
    }

    // Проверить, является ли это отказом из-за модерации контента (обычно возвращается 422 или 429, но содержит сообщение об отказе)
    const isContentRejection = detailError && (
        /reject|violat|terms|blocked|forbidden|unsafe|moderat/i.test(detailError) ||
        detailError === 'prompt failed'
    );
    if (isContentRejection) {
        return { error: `Контент заблокирован: ${detailError}`, code: ADAPTER_ERRORS.CONTENT_BLOCKED, retryable: false };
    }

    // Проверка лимита 429
    if (status === 429 || content?.includes('Too Many Requests')) {
        return { error: 'Сработало ограничение по частоте запросов / вышестоящий сервис перегружен', code: ADAPTER_ERRORS.RATE_LIMITED, retryable: true };
    }

    // Ошибка проверки reCAPTCHA
    if (content?.includes('recaptcha validation failed')) {
        return { error: 'Сработала проверка CAPTCHA', code: ADAPTER_ERRORS.CAPTCHA_REQUIRED, retryable: false };
    }

    // Ошибки сервера 5xx (можно повторить)
    if (status >= 500) {
        const msg = detailError
            ? `Ошибка вышестоящего сервера (${status}): ${detailError}`
            : `Ошибка вышестоящего сервера, HTTP-код: ${status}`;
        return { error: msg, code: ADAPTER_ERRORS.HTTP_ERROR, retryable: true };
    }

    // Ошибки клиента 4xx (не повторять)
    if (status >= 400) {
        const msg = detailError
            ? `Запрос отклонён (${status}): ${detailError}`
            : `Ошибка запроса, HTTP-код: ${status}`;
        return { error: msg, code: ADAPTER_ERRORS.HTTP_ERROR, retryable: false };
    }

    return null;
}

// ==========================================
// Универсальная нормализация ошибок
// ==========================================

/**
 * Стандартизирует объект ошибки (общий случай)
 * @param {string} error - Сообщение об ошибке
 * @returns {{error: string, code: string, retryable: boolean}}
 */
export function normalizeError(error) {
    const retryable = isRetryableError(error);

    let code = ADAPTER_ERRORS.NETWORK_ERROR;
    if (/timeout|тайм[- ]?аут|время ожидания/i.test(error)) {
        code = ADAPTER_ERRORS.TIMEOUT_ERROR;
    } else if (/crashed|crash|сбой|аварийн/i.test(error)) {
        code = ADAPTER_ERRORS.PAGE_CRASHED;
    } else if (/closed|закрыт/i.test(error)) {
        code = ADAPTER_ERRORS.PAGE_CLOSED;
    } else if (/5\d{2}|internal server|server error|ошибка сервера/i.test(error)) {
        code = ADAPTER_ERRORS.HTTP_ERROR;
    } else if (/rate limit|429|слишком много запросов|лимит запросов/i.test(error)) {
        code = ADAPTER_ERRORS.RATE_LIMITED;
    } else if (/captcha|recaptcha|капча/i.test(error)) {
        code = ADAPTER_ERRORS.CAPTCHA_REQUIRED;
    }

    return { error, code, retryable };
}
