<script setup>
import { onMounted, reactive } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { Modal, message } from 'ant-design-vue';

const settingsStore = useSettingsStore();

// Данные формы
const formData = reactive({
    port: 5173,
    authToken: '',
    keepaliveMode: 'comment',
    logLevel: 'info',
    queueBuffer: 2,
    imageLimit: 5
});

onMounted(async () => {
    await settingsStore.fetchServerConfig();
    Object.assign(formData, settingsStore.serverConfig);
});

// Логика сохранения
const doSave = async () => {
    await settingsStore.saveServerConfig(formData);
};

// Сохранить (с валидацией и подтверждением)
const handleSave = async () => {
    // Валидация: предупреждение при длине токена 1-9
    if (formData.authToken && formData.authToken.length > 0 && formData.authToken.length < 10) {
        message.error('Если токен задан, он должен содержать не менее 10 символов, или оставьте пустым');
        return;
    }

    // Диалог подтверждения при пустом токене
    if (!formData.authToken) {
        Modal.confirm({
            title: 'Предупреждение безопасности',
            content: 'Вы оставляете токен пустым: API и WebUI будут доступны без авторизации. Не используйте это в публичной сети!',
            okText: 'Оставить пустым',
            okType: 'danger',
            cancelText: 'Отмена',
            onOk: doSave
        });
        return;
    }

    // Обычное сохранение
    await doSave();
};
</script>

<template>
    <a-layout style="background: transparent;">
        <a-card title="Настройки сервера" :bordered="false" style="width: 100%;">
            <!-- Сетка формы -->
            <a-row :gutter="[16, 16]">
                <!-- Порт прослушивания -->
                <a-col :xs="24" :md="12">
                    <div style="margin-bottom: 8px;">
                        <div style="font-weight: 600; margin-bottom: 4px;">Порт прослушивания</div>
                        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px;">
                            Порт сервера, по умолчанию 5173
                        </div>
                        <a-input-number v-model:value="formData.port" :min="1" :max="65535" placeholder="Введите номер порта"
                            style="width: 100%" />
                    </div>
                </a-col>

                <!-- API Token -->
                <a-col :xs="24" :md="12">
                    <div style="margin-bottom: 8px;">
                        <div style="font-weight: 600; margin-bottom: 4px;">API Token</div>
                        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px;">
                            Ключ авторизации для API, оставьте пустым для отключения
                        </div>
                        <a-input-password v-model:value="formData.authToken" placeholder="Введите Token" type="password" />
                    </div>
                </a-col>

                <!-- Режим heartbeat -->
                <a-col :xs="24" :md="12">
                    <div style="margin-bottom: 8px;">
                        <div style="font-weight: 600; margin-bottom: 4px;">Режим heartbeat</div>
                        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px;">
                            Формат heartbeat-пакетов для SSE
                        </div>
                        <a-select v-model:value="formData.keepaliveMode" style="width: 100%" placeholder="Выберите режим heartbeat">
                            <a-select-option value="comment">Comment — формат комментария</a-select-option>
                            <a-select-option value="content">Content — формат данных</a-select-option>
                        </a-select>
                    </div>
                </a-col>

                <!-- Уровень логов -->
                <a-col :xs="24" :md="12">
                    <div style="margin-bottom: 8px;">
                        <div style="font-weight: 600; margin-bottom: 4px;">Уровень логов</div>
                        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px;">
                            Детализация журнала сервера
                        </div>
                        <a-select v-model:value="formData.logLevel" style="width: 100%" placeholder="Выберите уровень">
                            <a-select-option value="debug">Debug — отладка</a-select-option>
                            <a-select-option value="info">Info — информация</a-select-option>
                            <a-select-option value="warn">Warn — предупреждения</a-select-option>
                            <a-select-option value="error">Error — только ошибки</a-select-option>
                        </a-select>
                    </div>
                </a-col>
            </a-row>

            <!-- Кнопка сохранения -->
            <div style="display: flex; justify-content: flex-end; margin-top: 24px;">
                <a-button type="primary" @click="handleSave">
                    Сохранить
                </a-button>
            </div>
        </a-card>

        <!-- Настройки очереди -->
        <a-card title="Настройки очереди" :bordered="false" style="width: 100%; margin-top: 10px;">
            <a-row :gutter="[16, 16]">
                <!-- Буфер очереди -->
                <a-col :xs="24" :md="12">
                    <div style="margin-bottom: 8px;">
                        <div style="font-weight: 600; margin-bottom: 4px;">Буфер очереди</div>
                        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px;">
                            Дополнительных мест для не-потоковых запросов (0 = без ограничений)<br>
                            Лимит очереди = кол-во воркеров + буфер
                        </div>
                        <a-input-number v-model:value="formData.queueBuffer" :min="0" :max="100" placeholder="По умолчанию 2"
                            style="width: 100%" />
                    </div>
                </a-col>

                <!-- Лимит изображений -->
                <a-col :xs="24" :md="12">
                    <div style="margin-bottom: 8px;">
                        <div style="font-weight: 600; margin-bottom: 4px;">Лимит изображений</div>
                        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px;">
                            Максимум изображений в одном запросе<br>
                            Сайт поддерживает до 10 вложений, лишние будут отброшены
                        </div>
                        <a-input-number v-model:value="formData.imageLimit" :min="1" :max="10" placeholder="По умолчанию 5"
                            style="width: 100%" />
                    </div>
                </a-col>
            </a-row>

            <!-- Кнопка сохранения -->
            <div style="display: flex; justify-content: flex-end; margin-top: 24px;">
                <a-button type="primary" @click="handleSave">
                    Сохранить
                </a-button>
            </div>
        </a-card>
    </a-layout>
</template>

<style scoped>
/* Корректное отображение на мобильных */
.ant-input-number {
    width: 100%;
}
</style>