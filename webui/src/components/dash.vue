<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useSystemStore } from '@/stores/system';
import { useSettingsStore } from '@/stores/settings';
import {
    DesktopOutlined,
    PieChartOutlined,
    ChromeOutlined,
    FieldTimeOutlined,
    LineChartOutlined,
    SyncOutlined,
    ExclamationCircleOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined
} from '@ant-design/icons-vue';

const systemStore = useSystemStore();
const queueData = ref([]);
const timer = ref(null);
const queueStats = ref({ processing: 0, waiting: 0, total: 0 });

// Получить данные очереди
const fetchQueue = async () => {
    const settingsStore = useSettingsStore(); // получить store
    try {
        const res = await fetch('/admin/queue', { headers: settingsStore.getHeaders() });
        if (res.ok) {
            const data = await res.json();

            // Обновить статистику
            queueStats.value = {
                processing: data.processing || 0,
                waiting: data.waiting || 0,
                total: data.total || 0
            };

            const processing = (data.processingTasks || []).map(t => ({ ...t, status: 'processing' }));
            const waiting = (data.waitingTasks || []).map(t => ({ ...t, status: 'waiting' }));
            queueData.value = [...processing, ...waiting];
        }
    } catch (e) {
        console.error('Ошибка получения очереди', e);
    }
};

const refreshData = async () => {
    await Promise.all([
        systemStore.fetchStatus(),
        systemStore.fetchStats(),
        fetchQueue()
    ]);
};

const formatUptime = (seconds) => {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}д ${h}ч ${m}м`;
    if (h > 0) return `${h}ч ${m}м`;
    return `${m}м`;
};

const formatMemory = (mb) => {
    if (!mb || mb === 0) return '0 MB';
    if (mb > 1024) {
        return parseFloat((mb / 1024).toFixed(2)) + ' GB';
    }
    return parseFloat(Number(mb).toFixed(2)) + ' MB';
};

const getLoadColor = (usage) => {
    if (usage < 50) return '#52c41a'; // зелёный
    if (usage < 80) return '#faad14'; // оранжевый
    return '#f5222d'; // красный
};

// Сопоставление статусов
const getStatusConfig = (status) => {
    const map = {
        'normal': { color: 'green', text: 'Обычный режим' },
        'headless': { color: 'blue', text: 'Headless-режим' },
        'xvfb': { color: 'purple', text: 'Виртуальный дисплей (Xvfb)' }
    };
    return map[status] || { color: 'red', text: 'Не запущен' };
};

onMounted(() => {
    refreshData();
    timer.value = setInterval(refreshData, 5000); // Опрос каждые 5 сек
});

onUnmounted(() => {
    if (timer.value) clearInterval(timer.value);
});
</script>

<template>
    <a-layout style="width: 100%; background: transparent;">
        <!-- Баннер безопасного режима -->
        <a-alert v-if="systemStore.safeMode?.enabled" type="error" show-icon style="margin-bottom: 16px;" closable>
            <template #message>
                <span style="font-weight: 600;">⚠️ Безопасный режим</span>
            </template>
            <template #description>
                <div>
                    <p style="margin-bottom: 8px;">
                        Сервис перешёл в безопасный режим из-за ошибки инициализации. OpenAI API недоступен.
                    </p>
                    <p style="margin-bottom: 8px; color: #cf1322;">
                        <b>Причина:</b> {{ systemStore.safeMode.reason }}
                    </p>
                    <p style="margin: 0;">
                        Перейдите в «Настройки», исправьте конфигурацию и перезапустите сервис.
                    </p>
                </div>
            </template>
        </a-alert>

        <!-- Адаптивная раскладка -->
        <a-row :gutter="[16, 16]" style="margin-bottom: 24px">
            <!-- Карточка системы -->
            <a-col :xs="24" :md="12">
                <a-card title="Состояние системы" :bordered="false" style="height: 100%">
                    <a-space direction="vertical" style="width: 100%" size="middle">
                        <div style="display: flex; justify-content: space-between;">
                            <span>
                                <DesktopOutlined /> Версия системы:
                            </span>
                            <b>{{ systemStore.systemVersion }}</b>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span>
                                <FieldTimeOutlined /> Время работы:
                            </span>
                            <b>{{ formatUptime(systemStore.uptime) }}</b>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span>
                                <ChromeOutlined /> Статус:
                            </span>
                            <a-tag :color="getStatusConfig(systemStore.status).color">
                                {{ getStatusConfig(systemStore.status).text }}
                            </a-tag>
                        </div>

                        <div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>
                                    <LineChartOutlined /> Загрузка CPU:
                                </span>
                                <span>{{ systemStore.cpuUsage }}%</span>
                            </div>
                            <a-progress :percent="systemStore.cpuUsage"
                                :stroke-color="getLoadColor(systemStore.cpuUsage)" :show-info="false" />
                        </div>

                        <div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>
                                    <PieChartOutlined /> Оперативная память:
                                </span>
                                <span>{{ formatMemory(systemStore.memoryUsage.used) }} / {{
                                    formatMemory(systemStore.memoryUsage.total) }}</span>
                            </div>
                            <a-progress
                                :percent="Math.round((systemStore.memoryUsage.used / systemStore.memoryUsage.total) * 100) || 0"
                                :stroke-color="getLoadColor((systemStore.memoryUsage.used / systemStore.memoryUsage.total) * 100)"
                                :show-info="false" />
                        </div>
                    </a-space>
                </a-card>
            </a-col>

            <!-- Карточка статистики -->
            <a-col :xs="24" :md="12">
                <a-card title="Статистика" :bordered="false" style="height: 100%">
                    <a-row :gutter="16" style="margin-bottom: 24px">
                        <a-col :span="12">
                            <a-statistic title="Воркеров" :value="systemStore.stats.workers || 0">
                                <template #suffix>
                                    <span style="font-size: 14px; color: #8c8c8c;">шт.</span>
                                </template>
                            </a-statistic>
                        </a-col>
                        <a-col :span="12">
                            <a-statistic title="Экземпляров" :value="systemStore.stats.instances || 0">
                                <template #suffix>
                                    <span style=" font-size: 14px; color: #8c8c8c;">шт.</span>
                                </template>
                            </a-statistic>
                        </a-col>
                    </a-row>
                    <a-row :gutter="16">
                        <a-col :span="12">
                            <a-statistic title="В обработке" :value="queueStats.processing">
                                <template #suffix>
                                    <span style="font-size: 14px; color: #8c8c8c;">/ {{ queueStats.total }}</span>
                                </template>
                            </a-statistic>
                        </a-col>
                        <a-col :span="12">
                            <a-statistic title="В очереди" :value="queueStats.waiting">
                                <template #suffix>
                                    <span style="font-size: 14px; color: #8c8c8c;">/ {{ queueStats.total }}</span>
                                </template>
                            </a-statistic>
                        </a-col>
                    </a-row>
                    <a-row :gutter="16" style="margin-top: 16px">
                        <a-col :span="12">
                            <a-statistic title="Успешно сегодня" :value="systemStore.stats.success || 0">
                                <template #prefix>
                                    <CheckCircleOutlined style="color: #52c41a" />
                                </template>
                            </a-statistic>
                        </a-col>
                        <a-col :span="12">
                            <a-statistic title="Ошибок сегодня" :value="systemStore.stats.failed || 0">
                                <template #prefix>
                                    <CloseCircleOutlined style="color: #ff4d4f" />
                                </template>
                            </a-statistic>
                        </a-col>
                    </a-row>
                </a-card>
            </a-col>
        </a-row>

        <!-- Список очереди -->
        <a-card title="Мониторинг очереди" :bordered="false" style="width: 100%" :bodyStyle="{ padding: '0 24px' }">
            <template #extra>
                <div style="color: #8c8c8c; font-size: 12px;">
                    <SyncOutlined :spin="true" style="margin-right: 4px" /> Обновляется
                </div>
            </template>
            <a-list item-layout="horizontal" :data-source="queueData">
                <template #renderItem="{ item }">
                    <a-list-item>
                        <a-list-item-meta :description="`ID: ${item.id}`">
                            <template #title>
                                <span style="font-weight: 500; margin-right: 8px;">{{ item.model }}</span>
                                <a-tag v-if="item.worker" color="blue">{{ item.worker }}</a-tag>
                            </template>
                        </a-list-item-meta>

                        <div>
                            <a-tag v-if="item.status === 'processing'" color="processing">
                                <template #icon>
                                    <SyncOutlined :spin="true" />
                                </template>
                                В обработке
                            </a-tag>
                            <a-tag v-else-if="item.status === 'waiting'" color="warning">
                                <template #icon>
                                    <ExclamationCircleOutlined />
                                </template>
                                В очереди
                            </a-tag>
                            <a-tag v-else-if="item.status === 'success'" color="success">
                                <template #icon>
                                    <CheckCircleOutlined />
                                </template>
                                Завершено
                            </a-tag>
                        </div>
                    </a-list-item>
                </template>
                <div v-if="queueData.length === 0" style="text-align: center; padding: 24px; color: #8c8c8c;">
                    Нет задач
                </div>
            </a-list>
        </a-card>
    </a-layout>
</template>