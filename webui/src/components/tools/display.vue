<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import {
    DesktopOutlined,
    DisconnectOutlined,
    ExpandOutlined,
    CompressOutlined,
    ReloadOutlined
} from '@ant-design/icons-vue';

const settingsStore = useSettingsStore();

// Состояние
const loading = ref(true);
const vncStatus = ref(null);
const connectionState = ref('disconnected'); // disconnected, connecting, connected, error
const errorMessage = ref('');
const isFullscreen = ref(false);

// DOM-ссылки
const vncContainer = ref(null);

// Экземпляр noVNC
let rfb = null;
let RFB = null;

// Получить статус VNC
async function fetchVncStatus() {
    try {
        const res = await fetch('/admin/vnc/status', {
            headers: settingsStore.getHeaders()
        });
        if (res.ok) {
            vncStatus.value = await res.json();
        }
    } catch (e) {
        console.error('Ошибка получения статуса VNC', e);
    } finally {
        loading.value = false;
    }
}

// Подключить VNC
async function connectVnc() {
    if (!vncStatus.value?.enabled) return;

    connectionState.value = 'connecting';
    errorMessage.value = '';

    try {
        // Динамический импорт noVNC
        if (!RFB) {
            const module = await import('@novnc/novnc/core/rfb.js');
            RFB = module.default;
        }

        // Построить WebSocket URL
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/admin/vnc?token=${settingsStore.token}`;

        // Создать экземпляр RFB
        rfb = new RFB(vncContainer.value, wsUrl, {
            wsProtocols: ['binary']
        });

        // Конфигурация
        rfb.scaleViewport = true;   // Масштабировать под контейнер
        rfb.clipViewport = false;   // Не обрезать viewport
        rfb.resizeSession = false;   // Разрешить изменение разрешения

        // Прослушивание событий
        rfb.addEventListener('connect', () => {
            connectionState.value = 'connected';
        });

        rfb.addEventListener('disconnect', (e) => {
            connectionState.value = 'disconnected';
            if (e.detail.clean === false) {
                errorMessage.value = 'Соединение неожиданно прервано';
            }
            rfb = null;
        });

        rfb.addEventListener('credentialsrequired', () => {
            rfb.sendCredentials({ password: '' });
        });

    } catch (e) {
        connectionState.value = 'error';
        errorMessage.value = e.message || 'Ошибка подключения';
    }
}

// Отключить
function disconnectVnc() {
    if (rfb) {
        rfb.disconnect();
        rfb = null;
    }
    connectionState.value = 'disconnected';
}

// Переключить полноэкранный режим
function toggleFullscreen() {
    if (!vncContainer.value) return;

    if (!document.fullscreenElement) {
        vncContainer.value.requestFullscreen();
        isFullscreen.value = true;
    } else {
        document.exitFullscreen();
        isFullscreen.value = false;
    }
}

// Слушать изменения полноэкранного режима
function handleFullscreenChange() {
    isFullscreen.value = !!document.fullscreenElement;
}

onMounted(async () => {
    await fetchVncStatus();
    document.addEventListener('fullscreenchange', handleFullscreenChange);
});

onUnmounted(() => {
    disconnectVnc();
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
});
</script>

<template>
    <a-layout style="background: transparent;">
        <a-card title="Виртуальный дисплей" :bordered="false" style="height: 100%">
            <!-- Загрузка -->
            <div v-if="loading" style="text-align: center; padding: 48px;">
                <a-spin size="large" />
                <div style="margin-top: 16px; color: #8c8c8c;">Проверка статуса VNC...</div>
            </div>

            <!-- Не в режиме xvfb -->
            <div v-else-if="!vncStatus?.xvfbMode" style="text-align: center; padding: 48px;">
                <DisconnectOutlined style="font-size: 64px; color: #bfbfbf;" />
                <div style="margin-top: 16px; font-size: 16px; color: #595959;">Программа запущена без виртуального дисплея</div>
                <div style="margin-top: 8px; color: #8c8c8c;">
                    VNC доступен только в Linux при запуске с параметрами <code>-xvfb -vnc</code>
                </div>
            </div>

            <!-- xvfb включён, но VNC не запущен -->
            <div v-else-if="!vncStatus?.enabled" style="text-align: center; padding: 48px;">
                <DesktopOutlined style="font-size: 64px; color: #bfbfbf;" />
                <div style="margin-top: 16px; font-size: 16px; color: #595959;">VNC-сервер не запущен</div>
                <div style="margin-top: 8px; color: #8c8c8c;">
                    Убедитесь, что запущен с параметром <code>-vnc</code> и установлен x11vnc
                </div>
            </div>

            <!-- VNC доступен -->
            <div v-else>
                <!-- Панель управления -->
                <div style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <a-tag v-if="connectionState === 'connected'" color="success">Подключено</a-tag>
                        <a-tag v-else-if="connectionState === 'connecting'" color="processing">Подключение...</a-tag>
                        <a-tag v-else-if="connectionState === 'error'" color="error">Ошибка соединения</a-tag>
                        <a-tag v-else color="default">Не подключено</a-tag>
                        <span v-if="errorMessage" style="margin-left: 8px; color: #ff4d4f; font-size: 12px;">
                            {{ errorMessage }}
                        </span>
                    </div>
                    <a-space>
                        <a-button v-if="connectionState !== 'connected'" type="primary" @click="connectVnc"
                            :loading="connectionState === 'connecting'">
                            <template #icon>
                                <DesktopOutlined />
                            </template>
                            Подключить
                        </a-button>
                        <a-button v-else danger @click="disconnectVnc">
                            <template #icon>
                                <DisconnectOutlined />
                            </template>
                            Отключить
                        </a-button>
                        <a-button @click="toggleFullscreen" :disabled="connectionState !== 'connected'">
                            <template #icon>
                                <CompressOutlined v-if="isFullscreen" />
                                <ExpandOutlined v-else />
                            </template>
                        </a-button>
                        <a-button @click="fetchVncStatus">
                            <template #icon>
                                <ReloadOutlined />
                            </template>
                        </a-button>
                    </a-space>
                </div>

                <!-- Область отображения VNC -->
                <div ref="vncContainer"
                    style="width: 100%; aspect-ratio: 16/9; min-height: 400px; max-height: 70vh; background: #000; border-radius: 8px; overflow: hidden;">
                    <div v-if="connectionState === 'disconnected'"
                        style="height: 100%; display: flex; align-items: center; justify-content: center; color: #595959;">
                        <div style="text-align: center;">
                            <DesktopOutlined style="font-size: 48px; color: #434343;" />
                            <div style="margin-top: 16px;">Нажмите «Подключить» для просмотра удалённого дисплея</div>
                        </div>
                    </div>
                </div>

                <!-- Информация -->
                <div style="margin-top: 12px; font-size: 12px; color: #8c8c8c;">
                    Дисплей: {{ vncStatus.display }} | Порт VNC: {{ vncStatus.port }}
                </div>
            </div>
        </a-card>
    </a-layout>
</template>
