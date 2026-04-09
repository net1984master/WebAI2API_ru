<script setup>
import { ref, onMounted, reactive, computed } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { message } from 'ant-design-vue';
import { SettingOutlined, AppstoreOutlined } from '@ant-design/icons-vue';

const settingsStore = useSettingsStore();

const drawerVisible = ref(false);
const currentAdapter = ref(null);
const currentConfig = reactive({});

// Конфигурация фильтрации моделей
const modelFilter = reactive({
    mode: 'blacklist',
    list: []
});

// Загрузка данных при монтировании
onMounted(async () => {
    await Promise.all([
        settingsStore.fetchAdaptersMeta(),
        settingsStore.fetchAdapterConfig()
    ]);
});

// Список адаптеров
const adapters = computed(() => settingsStore.adaptersMeta);

// Проверить, включена ли модель
const isModelEnabled = (modelId) => {
    const inList = modelFilter.list.includes(modelId);
    if (modelFilter.mode === 'whitelist') {
        return inList;
    } else {
        return !inList;
    }
};

// Переключить состояние модели
const toggleModel = (modelId, enabled) => {
    const idx = modelFilter.list.indexOf(modelId);

    if (modelFilter.mode === 'whitelist') {
        // Белый список: включить=добавить, выключить=удалить
        if (enabled && idx === -1) {
            modelFilter.list.push(modelId);
        } else if (!enabled && idx !== -1) {
            modelFilter.list.splice(idx, 1);
        }
    } else {
        // Чёрный список: выключить=добавить, включить=удалить
        if (!enabled && idx === -1) {
            modelFilter.list.push(modelId);
        } else if (enabled && idx !== -1) {
            modelFilter.list.splice(idx, 1);
        }
    }
};

// Сбросить список при смене режима
const onModeChange = (newMode) => {
    if (newMode !== modelFilter.mode) {
        modelFilter.mode = newMode;
        modelFilter.list = [];
    }
};

// Открыть панель редактирования
const handleEdit = (adapter) => {
    currentAdapter.value = adapter;
    // Загрузить текущие настройки или дефолты
    const existing = settingsStore.adapterConfig[adapter.id] || {};

    // Сбросить форму
    Object.keys(currentConfig).forEach(key => delete currentConfig[key]);

    // Инициализировать форму из текущих значений или дефолтов
    if (adapter.configSchema) {
        adapter.configSchema.forEach(field => {
            if (existing[field.key] !== undefined) {
                currentConfig[field.key] = existing[field.key];
            } else {
                currentConfig[field.key] = field.default;
            }
        });
    }

    // Инициализировать конфигурацию фильтрации
    const filter = adapter.modelFilter || { mode: 'blacklist', list: [] };
    modelFilter.mode = filter.mode || 'blacklist';
    modelFilter.list = [...(filter.list || [])];

    drawerVisible.value = true;
};

// Сохранить конфигурацию
const handleSave = async () => {
    if (!currentAdapter.value) return;

    const configToSave = {
        [currentAdapter.value.id]: {
            ...currentConfig,
            modelFilter: {
                mode: modelFilter.mode,
                list: [...modelFilter.list]
            }
        }
    };

    const success = await settingsStore.saveAdapterConfig(configToSave);
    if (success) {
        // Обновить локальный кэш
        const adapter = settingsStore.adaptersMeta.find(a => a.id === currentAdapter.value.id);
        if (adapter) {
            adapter.modelFilter = { mode: modelFilter.mode, list: [...modelFilter.list] };
        }
        drawerVisible.value = false;
    }
};
</script>

<template>
    <a-layout style="background: transparent;">
        <a-card title="Адаптеры" :bordered="false">
            <template #extra>
                <a-button type="link" @click="settingsStore.fetchAdaptersMeta">Обновить</a-button>
            </template>

            <a-list :grid="{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 3, xl: 4, xxl: 4 }" :data-source="adapters">
                <template #renderItem="{ item }">
                    <a-list-item>
                        <a-card hoverable @click="handleEdit(item)" :bodyStyle="{ padding: '12px 16px' }">
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                                <div style="display: flex; align-items: center; min-width: 0; flex: 1;">
                                    <AppstoreOutlined
                                        style="font-size: 18px; color: #1890ff; margin-right: 8px; flex-shrink: 0;" />
                                    <span
                                        style="font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{
                                            item.id }}</span>
                                </div>
                                <SettingOutlined style="font-size: 16px; color: #8c8c8c; flex-shrink: 0;" />
                            </div>
                        </a-card>
                    </a-list-item>
                </template>
            </a-list>
        </a-card>

        <!-- Панель конфигурации -->
        <a-drawer v-if="currentAdapter" v-model:open="drawerVisible" :title="`Настройка адаптера — ${currentAdapter.id}`" width="500"
            placement="right">
            <!-- Описание адаптера -->
            <div v-if="currentAdapter.description"
                style="margin-bottom: 16px; padding: 12px; background: #f5f5f5; border-radius: 6px; color: #666; font-size: 13px; line-height: 1.6;">
                {{ currentAdapter.description }}
            </div>

            <!-- Управление моделями -->
            <a-collapse v-if="currentAdapter.models && currentAdapter.models.length > 0" style="margin-bottom: 16px;">
                <a-collapse-panel key="models" header="Управление моделями">
                    <!-- Выбор режима -->
                    <div style="margin-bottom: 12px;">
                        <span style="margin-right: 12px; color: #666;">Режим фильтра:</span>
                        <a-radio-group :value="modelFilter.mode" @change="e => onModeChange(e.target.value)">
                            <a-radio value="blacklist">Чёрный список</a-radio>
                            <a-radio value="whitelist">Белый список</a-radio>
                        </a-radio-group>
                    </div>
                    <div style="font-size: 12px; color: #999; margin-bottom: 12px;">
                        {{ modelFilter.mode === 'blacklist' ? 'Отключённые модели недоступны, остальные работают' : 'Только включённые модели доступны, остальные отключены' }}
                    </div>

                    <!-- Список моделей -->
                    <div style="max-height: 300px; overflow-y: auto;">
                        <div v-for="modelId in currentAdapter.models" :key="modelId"
                            style="display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0f0f0;">
                            <span style="font-size: 13px; color: #333;">{{ modelId }}</span>
                            <a-switch :checked="isModelEnabled(modelId)"
                                @change="checked => toggleModel(modelId, checked)" size="small" />
                        </div>
                    </div>
                </a-collapse-panel>
            </a-collapse>

            <!-- Другие параметры -->
            <div v-if="!currentAdapter.configSchema || currentAdapter.configSchema.length === 0">
                <a-empty v-if="!currentAdapter.models || currentAdapter.models.length === 0" description="Нет настраиваемых параметров" />
            </div>

            <a-form layout="vertical" v-if="currentAdapter.configSchema && currentAdapter.configSchema.length > 0">
                <template v-for="field in currentAdapter.configSchema" :key="field.key">
                    <a-form-item :label="field.label" :required="field.required">
                        <!-- Строковый ввод -->
                        <a-input v-if="field.type === 'string'" v-model:value="currentConfig[field.key]"
                            :placeholder="field.placeholder" />

                        <!-- Числовой ввод -->
                        <a-input-number v-if="field.type === 'number'" v-model:value="currentConfig[field.key]"
                            :min="field.min" :max="field.max" style="width: 100%;" />

                        <!-- Переключатель -->
                        <div v-if="field.type === 'boolean'">
                            <a-switch v-model:checked="currentConfig[field.key]" />
                        </div>

                        <!-- Выпадающий список -->
                        <a-select v-if="field.type === 'select'" v-model:value="currentConfig[field.key]"
                            :options="field.options" />

                        <div v-if="field.note" style="font-size: 12px; color: #8c8c8c; margin-top: 4px;">
                            {{ field.note }}
                        </div>
                    </a-form-item>
                </template>
            </a-form>

            <template #footer>
                <div style="text-align: right;">
                    <a-button style="margin-right: 8px" @click="drawerVisible = false">Отмена</a-button>
                    <a-button type="primary" @click="handleSave">Сохранить</a-button>
                </div>
            </template>
        </a-drawer>
    </a-layout>
</template>
