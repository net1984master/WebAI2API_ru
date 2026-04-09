<script setup>
import { ref } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { message } from 'ant-design-vue';
import { LockOutlined } from '@ant-design/icons-vue';

const props = defineProps({
    visible: {
        type: Boolean,
        required: true
    }
});

const emit = defineEmits(['update:visible', 'success']);

const settingsStore = useSettingsStore();
const token = ref(settingsStore.token);
const loading = ref(false);

const handleLogin = async () => {
    if (!token.value) {
        message.warning('Введите токен');
        return;
    }

    loading.value = true;
    try {
        const originalToken = settingsStore.token;
        settingsStore.setToken(token.value);

        const success = await settingsStore.checkAuth();
        if (success) {
            message.success('Авторизация успешна');
            emit('success');
            emit('update:visible', false);
        } else {
            message.error('Ошибка токена, проверьте правильность');
            settingsStore.setToken(originalToken);
        }
    } catch (e) {
        message.error('Ошибка при проверке авторизации');
    } finally {
        loading.value = false;
    }
};
</script>

<template>
    <a-modal :open="visible" title="Требуется авторизация" :closable="false" :maskClosable="false" :footer="null" width="400px"
        centered>
        <div style="padding: 20px 0;">
            <div style="text-align: center; margin-bottom: 24px;">
                <a-avatar :size="64" style="background-color: #1890ff">
                    <template #icon>
                        <LockOutlined />
                    </template>
                </a-avatar>
                <div style="margin-top: 16px; font-size: 16px; font-weight: 500;">
                    Панель управления WebAI2API
                </div>
                <div style="color: #8c8c8c; margin-top: 8px;">
                    Введите API Token для продолжения
                </div>
            </div>

            <a-form layout="vertical">
                <a-form-item label="API Token">
                    <a-input-password v-model:value="token" placeholder="Введите API Token" size="large"
                        @pressEnter="handleLogin">
                        <template #prefix>
                            <LockOutlined style="color: rgba(0,0,0,.25)" />
                        </template>
                    </a-input-password>
                </a-form-item>

                <a-button type="primary" block size="large" :loading="loading" @click="handleLogin">
                    Войти
                </a-button>
            </a-form>
        </div>
    </a-modal>
</template>
