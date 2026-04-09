<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import {
    ReloadOutlined,
    DeleteOutlined,
    SearchOutlined,
    DownloadOutlined,
    WarningOutlined,
    CloseCircleOutlined,
    InfoCircleOutlined,
    BugOutlined,
    CheckCircleOutlined
} from '@ant-design/icons-vue';
import { message, Modal } from 'ant-design-vue';

const settingsStore = useSettingsStore();

const logs = ref([]);
const loading = ref(false);
const total = ref(0);
const autoRefresh = ref(false);
const refreshInterval = ref(null);
const searchText = ref('');
const levelFilter = ref('all');

// Статистика
const dateRange = ref([]);
const rangeStats = ref({ success: 0, failed: 0, days: 0 });
const statsLoading = ref(false);

// Конфигурация уровней логов
const levelConfig = {
    'INFO': { color: '#1890ff', icon: InfoCircleOutlined },
    'WARN': { color: '#faad14', icon: WarningOutlined },
    'ERRO': { color: '#ff4d4f', icon: CloseCircleOutlined },
    'DBUG': { color: '#722ed1', icon: BugOutlined }
};

// Получить логи
const fetchLogs = async () => {
    loading.value = true;
    try {
        const res = await fetch('/admin/logs?lines=500', {
            headers: settingsStore.getHeaders()
        });
        if (res.ok) {
            const data = await res.json();
            logs.value = parseLogs(data.logs || []);
            total.value = data.total || 0;
        }
    } catch (e) {
        message.error('Ошибка получения логов');
    } finally {
        loading.value = false;
    }
};

// Разбор строки лога
const parseLogs = (lines) => {
    return lines.map((line, index) => {
        // Формат: 2025-12-20 17:00:00.000 [INFO] [Модуль] Сообщение
        const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[(\w+)\] \[([^\]]+)\] (.*)$/);
        if (match) {
            return {
                id: index,
                time: match[1],
                level: match[2],
                module: match[3],
                message: match[4],
                raw: line
            };
        }
        return { id: index, raw: line, level: 'INFO', time: '', module: '', message: line };
    });
};

// Отфильтрованные логи (новые сверху)
const filteredLogs = computed(() => {
    const filtered = logs.value.filter(log => {
        // Фильтр по уровню
        if (levelFilter.value !== 'all' && log.level !== levelFilter.value) {
            return false;
        }
        // Поиск
        if (searchText.value) {
            const search = searchText.value.toLowerCase();
            return log.raw.toLowerCase().includes(search);
        }
        return true;
    });
    // Обратный порядок — новые логи сверху
    return filtered.reverse();
});

// Очистить журнал
const clearLogs = () => {
    Modal.confirm({
        title: 'Подтверждение очистки логов',
        content: 'Будут удалены все файлы системного журнала. Продолжить?',
        okText: 'Очистить',
        okType: 'danger',
        cancelText: 'Отмена',
        async onOk() {
            try {
                const res = await fetch('/admin/logs', {
                    method: 'DELETE',
                    headers: settingsStore.getHeaders()
                });
                if (res.ok) {
                    message.success('Журнал очищен');
                    logs.value = [];
                    total.value = 0;
                } else {
                    message.error('Ошибка очистки');
                }
            } catch (e) {
                message.error('Ошибка запроса');
            }
        }
    });
};

// Экспорт журнала
const exportLogs = () => {
    const content = logs.value.map(l => l.raw).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `system-${new Date().toISOString().split('T')[0]}.log`;
    a.click();
    URL.revokeObjectURL(url);
};

// Переключить авто-обновление
const toggleAutoRefresh = (newState) => {
    autoRefresh.value = newState;
    if (newState) {
        fetchLogs(); // Немедленно обновить
        refreshInterval.value = setInterval(fetchLogs, 5000);
    } else {
        if (refreshInterval.value) {
            clearInterval(refreshInterval.value);
            refreshInterval.value = null;
        }
    }
};

// Запрос статистики за период
const fetchRangeStats = async () => {
    if (!dateRange.value || dateRange.value.length !== 2) {
        rangeStats.value = { success: 0, failed: 0, days: 0 };
        return;
    }

    statsLoading.value = true;
    try {
        const [start, end] = dateRange.value;
        const res = await fetch(
            `/admin/stats/range?start=${start.format('YYYY-MM-DD')}&end=${end.format('YYYY-MM-DD')}`,
            { headers: settingsStore.getHeaders() }
        );
        if (res.ok) {
            rangeStats.value = await res.json();
        }
    } catch (e) {
        message.error('Ошибка получения статистики');
    } finally {
        statsLoading.value = false;
    }
};

// Удалить статистику за период
const clearRangeStats = () => {
    if (!dateRange.value || dateRange.value.length !== 2) {
        message.warning('Сначала выберите диапазон дат');
        return;
    }

    Modal.confirm({
        title: 'Подтверждение удаления',
        content: `Удалить статистику с ${dateRange.value[0].format('YYYY-MM-DD')} по ${dateRange.value[1].format('YYYY-MM-DD')}?`,
        okText: 'Удалить',
        okType: 'danger',
        cancelText: 'Отмена',
        async onOk() {
            try {
                const [start, end] = dateRange.value;
                const res = await fetch(
                    `/admin/stats/range?start=${start.format('YYYY-MM-DD')}&end=${end.format('YYYY-MM-DD')}`,
                    { method: 'DELETE', headers: settingsStore.getHeaders() }
                );
                if (res.ok) {
                    message.success('Статистика удалена');
                    rangeStats.value = { success: 0, failed: 0, days: 0 };
                }
            } catch (e) {
                message.error('Ошибка удаления');
            }
        }
    });
};

onMounted(() => {
    fetchLogs();
});

onUnmounted(() => {
    if (refreshInterval.value) {
        clearInterval(refreshInterval.value);
    }
});
</script>

<template>
    <!-- Панель статистики -->
    <a-card title="Статистика запросов" :bordered="false">
        <template #extra>
            <a-button type="link" danger size="small" @click="clearRangeStats"
                :disabled="!dateRange || dateRange.length !== 2">
                <template #icon>
                    <DeleteOutlined />
                </template>
                Удалить
            </a-button>
        </template>

        <div class="stats-content">
            <a-range-picker v-model:value="dateRange" :format="'YYYY-MM-DD'" :placeholder="['Начало', 'Конец']"
                size="small" class="stats-date-picker" @change="fetchRangeStats" />

            <a-divider type="vertical" style="height: 32px; margin: 0 16px" />

            <a-spin :spinning="statsLoading" size="small">
                <div class="stats-numbers">
                    <div class="stat-item success">
                        <CheckCircleOutlined />
                        <span class="stat-value">{{ rangeStats.success }}</span>
                        <span class="stat-label">Успешно</span>
                    </div>
                    <div class="stat-item error">
                        <CloseCircleOutlined />
                        <span class="stat-value">{{ rangeStats.failed }}</span>
                        <span class="stat-label">Ошибок</span>
                    </div>
                    <div class="stat-item neutral">
                        <span class="stat-value">{{ rangeStats.days }}</span>
                        <span class="stat-label">дн.</span>
                    </div>
                </div>
            </a-spin>
        </div>
    </a-card>

    <!-- Системный журнал -->
    <a-card title="Системный журнал" :bordered="false" style="margin-top: 24px">
        <!-- Панель инструментов -->
        <div class="toolbar">
            <!-- Строка 1: фильтр и кнопки -->
            <div class="toolbar-row">
                <a-select v-model:value="levelFilter" style="width: 90px" size="small">
                    <a-select-option value="all">Все</a-select-option>
                    <a-select-option value="INFO">INFO</a-select-option>
                    <a-select-option value="WARN">WARN</a-select-option>
                    <a-select-option value="ERRO">ERROR</a-select-option>
                    <a-select-option value="DBUG">DEBUG</a-select-option>
                </a-select>
                <a-space :size="4">
                    <a-tooltip :title="autoRefresh ? 'Отключить авто-обновление' : 'Включить авто-обновление'">
                        <a-button size="small" :type="autoRefresh ? 'primary' : 'default'"
                            @click="toggleAutoRefresh(!autoRefresh)">
                            <template #icon>
                                <ReloadOutlined />
                            </template>
                        </a-button>
                    </a-tooltip>
                    <a-tooltip title="Экспорт">
                        <a-button size="small" @click="exportLogs">
                            <template #icon>
                                <DownloadOutlined />
                            </template>
                        </a-button>
                    </a-tooltip>
                    <a-tooltip title="Очистить">
                        <a-button size="small" danger @click="clearLogs">
                            <template #icon>
                                <DeleteOutlined />
                            </template>
                        </a-button>
                    </a-tooltip>
                </a-space>
            </div>
            <!-- Строка 2: поиск -->
            <div class="toolbar-row">
                <a-input-search v-model:value="searchText" placeholder="Поиск в журнале" size="small" enter-button allow-clear
                    style="width: 100%;" />
            </div>
        </div>

        <!-- Статистика -->
        <div style="margin-bottom: 12px; color: #8c8c8c; font-size: 12px;">
            Всего {{ total }} записей, показано {{ filteredLogs.length }}
            <span v-if="autoRefresh" style="color: #1890ff; margin-left: 8px;">
                <ReloadOutlined :spin="true" /> Авто-обновление
            </span>
        </div>

        <!-- Список логов -->
        <div class="log-container">
            <div v-for="log in filteredLogs" :key="log.id" class="log-line" :class="'level-' + log.level.toLowerCase()">
                <div class="log-meta">
                    <a-tag :color="levelConfig[log.level]?.color || '#8c8c8c'" size="small" style="margin: 0;">
                        {{ log.level }}
                    </a-tag>
                    <span class="log-module">[{{ log.module }}]</span>
                    <span class="log-time">{{ log.time }}</span>
                </div>
                <span class="log-message">{{ log.message }}</span>
            </div>
            <a-empty v-if="filteredLogs.length === 0" description="Журнал пуст" />
        </div>
    </a-card>
</template>

<style scoped>
.log-container {
    max-height: 600px;
    overflow-y: auto;
    overflow-x: auto;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 12px;
    background: #fafafa;
    border-radius: 4px;
    padding: 12px;
}

.log-line {
    padding: 4px 0;
    border-bottom: 1px solid #f0f0f0;
    display: flex;
    align-items: baseline;
    gap: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.log-line:hover {
    background: #e6f7ff;
    white-space: normal;
    word-break: break-all;
}

.log-meta {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
}

.log-time {
    color: #8c8c8c;
}

.log-module {
    color: #1890ff;
    margin-right: 4px;
}

.log-message {
    color: #333;
    overflow: hidden;
    text-overflow: ellipsis;
}

.level-erro .log-message {
    color: #ff4d4f;
}

.level-warn .log-message {
    color: #faad14;
}

.level-dbug .log-message {
    color: #722ed1;
}

/* Стили панели инструментов */
.toolbar {
    margin-bottom: 16px;
}

.toolbar-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
}

.toolbar-row:last-child {
    margin-bottom: 0;
}

/* Широкий экран: панель в одну строку */
@media (min-width: 768px) {
    .toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
    }

    .toolbar-row {
        margin-bottom: 0;
    }

    .toolbar-row:last-child {
        flex: 1;
        max-width: 300px;
    }
}

/* Стили статистики */

.stats-content {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
}

.stats-numbers {
    display: flex;
    align-items: center;
    gap: 20px;
}

.stat-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    background: #fafafa;
    border-radius: 6px;
    transition: all 0.2s;
}

.stat-item:hover {
    background: #f0f0f0;
}

.stat-item.success {
    color: #52c41a;
}

.stat-item.error {
    color: #ff4d4f;
}

.stat-item.neutral {
    color: #8c8c8c;
}

.stat-value {
    font-size: 18px;
    font-weight: 600;
    font-family: 'SF Mono', 'Monaco', monospace;
}

.stat-label {
    font-size: 12px;
    color: #8c8c8c;
}

/* 日期选择器 */
.stats-date-picker {
    width: 240px;
}

/* 响应式：小屏幕统计面板垂直布局 */
@media (max-width: 576px) {
    .stats-content {
        flex-direction: column;
        align-items: flex-start;
    }

    .stats-content .ant-divider {
        display: none;
    }

    .stats-numbers {
        margin-top: 8px;
    }
}

/* 响应式：移动端日志堆叠布局 */
@media (max-width: 768px) {
    .stats-date-picker {
        width: 100%;
    }

    .log-container {
        padding: 8px;
        font-size: 11px;
    }

    .log-line {
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        white-space: normal;
        word-break: break-all;
        padding: 6px 0;
    }

    .log-line:hover {
        white-space: normal;
    }

    .log-meta {
        flex-wrap: wrap;
    }

    .log-time {
        font-size: 10px;
    }

    .log-message {
        white-space: normal;
        word-break: break-all;
        overflow: visible;
    }
}
</style>
