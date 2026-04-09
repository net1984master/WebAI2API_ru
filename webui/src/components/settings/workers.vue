<script setup>
import { ref, onMounted, computed } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { Modal } from 'ant-design-vue';

const settingsStore = useSettingsStore();

const poolConfig = computed({
    get: () => settingsStore.poolConfig,
    set: (val) => settingsStore.poolConfig = val
});

const handleSavePool = async () => {
    await settingsStore.savePoolConfig(poolConfig.value);
};

// Загрузка начальных данных
onMounted(async () => {
    await Promise.all([
        settingsStore.fetchWorkerConfig(),
        settingsStore.fetchPoolConfig(),
        settingsStore.fetchAdaptersMeta()
    ]);
});

// Вычисляемые параметры адаптеров (включая merge)
const adapterOptions = computed(() => {
    const options = settingsStore.adaptersMeta.map(a => ({
        label: a.displayName || a.id,
        value: a.id
    }));
    // Merge — первым в списке
    if (!options.find(o => o.value === 'merge')) {
        options.unshift({ label: 'Merge (агрегированный режим)', value: 'merge' });
    }
    return options;
});

// Адаптеры без merge (без рекурсии)
const mergeableAdapterOptions = computed(() => {
    return settingsStore.adaptersMeta
        .filter(a => a.id !== 'merge')
        .map(a => ({
            label: a.displayName || a.id,
            value: a.id
        }));
});

// Вспомогательная: получить displayName по ID адаптера
const getAdapterDisplayName = (id) => {
    if (id === 'merge') return 'Merge (агрегированный режим)';
    const adapter = settingsStore.adaptersMeta.find(a => a.id === id);
    return adapter?.displayName || id;
};

// Определение колонок таблицы
const columns = [
    {
        title: 'Имя экземпляра',
        dataIndex: 'name',
        key: 'name',
    },
    {
        title: 'Воркеров',
        dataIndex: 'workerCount',
        key: 'workerCount',
    },
    {
        title: 'Прокси',
        dataIndex: 'proxy',
        key: 'proxy',
    },
    {
        title: 'Метка данных',
        key: 'userDataMark',
        dataIndex: 'userDataMark',
    },
    {
        title: 'Действия',
        key: 'action',
    },
];

// Данные списка из Store
const instanceData = computed({
    get: () => settingsStore.workerConfig,
    set: (val) => { settingsStore.workerConfig = val; }
});

// Получите уникальный идентификатор экземпляра（优先 id，没有则用 name）
const getInstanceKey = (inst) => inst.id || inst.name;

// Выбор партии
const selectedRowKeys = ref([]);
const rowSelection = computed(() => ({
    selectedRowKeys: selectedRowKeys.value,
    onChange: (keys) => { selectedRowKeys.value = keys; }
}));

// Массовая настройка прокси
const batchProxyVisible = ref(false);
const batchProxyForm = ref({
    proxy: true,
    proxyType: 'socks5',
    proxyHost: '',
    proxyPort: 1080,
    proxyAuth: false,
    proxyUsername: '',
    proxyPassword: ''
});

const openBatchProxy = () => {
    batchProxyForm.value = {
        proxy: true,
        proxyType: 'socks5',
        proxyHost: '',
        proxyPort: 1080,
        proxyAuth: false,
        proxyUsername: '',
        proxyPassword: ''
    };
    batchProxyVisible.value = true;
};

const handleBatchProxySave = async () => {
    const newList = (instanceData.value || []).map(inst => {
        if (!selectedRowKeys.value.includes(getInstanceKey(inst))) return inst;
        return {
            ...inst,
            proxy: batchProxyForm.value.proxy ? {
                enable: true,
                type: batchProxyForm.value.proxyType,
                host: batchProxyForm.value.proxyHost,
                port: batchProxyForm.value.proxyPort,
                auth: batchProxyForm.value.proxyAuth,
                username: batchProxyForm.value.proxyUsername,
                password: batchProxyForm.value.proxyPassword
            } : null
        };
    });
    const success = await settingsStore.saveWorkerConfig(newList);
    if (success) {
        batchProxyVisible.value = false;
        selectedRowKeys.value = [];
    }
};

// Массовое удаление
const handleBatchDelete = () => {
    Modal.confirm({
        title: 'Удалить экземпляры',
        content: `Удалить ${selectedRowKeys.value.length} выбранных экземпляра? Отменить невозможно.`,
        okText: 'Удалить',
        okType: 'danger',
        cancelText: 'Отмена',
        async onOk() {
            const newList = (instanceData.value || []).filter(
                inst => !selectedRowKeys.value.includes(getInstanceKey(inst))
            );
            const success = await settingsStore.saveWorkerConfig(newList);
            if (success) {
                selectedRowKeys.value = [];
            }
        }
    });
};

// Состояние панели
const drawerOpen = ref(false);
const editingInstance = ref(null);

// Данные формы редактирования
const editForm = ref({
    name: '',
    userDataMark: '',
    proxy: false,
    proxyType: 'socks5',
    proxyHost: '',
    proxyPort: 1080,
    proxyAuth: false,
    proxyUsername: '',
    proxyPassword: '',
    workers: []
});

// Создать экземпляр
const handleCreateInstance = () => {
    editingInstance.value = null; // null = новый экземпляр
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    // Сбросить форму к дефолтам
    editForm.value = {
        name: `instance-${(instanceData.value || []).length + 1}-${randomSuffix}`,
        userDataMark: '',
        proxy: false,
        proxyType: 'socks5',
        proxyHost: '',
        proxyPort: 1080,
        proxyAuth: false,
        proxyUsername: '',
        proxyPassword: '',
        workers: []
    };
    drawerOpen.value = true;
};

// Редактировать экземпляр
const handleEdit = (record) => {
    editingInstance.value = record;
    // Заполнить форму
    editForm.value = {
        name: record.name,
        userDataMark: record.userDataMark || '',
        proxy: record.proxy ? true : false,
        proxyType: record.proxy?.type || 'socks5',
        proxyHost: record.proxy?.host || '',
        proxyPort: record.proxy?.port || 1080,
        proxyAuth: record.proxy?.auth || false,
        proxyUsername: record.proxy?.username || '',
        proxyPassword: record.proxy?.password || '',
        workers: record.workers ? [...record.workers] : []
    };
    // Совместимость с булевым значением прокси на фронтенде
    if (record.proxy === null || record.proxy === undefined) {
        editForm.value.proxy = false;
    }
    drawerOpen.value = true;
};

// Удалить экземпляр
const handleDelete = async (record) => {
    const key = getInstanceKey(record);
    const newList = instanceData.value.filter(item => getInstanceKey(item) !== key);
    await settingsStore.saveWorkerConfig(newList);
};

// Сохранить изменения
const handleSaveEdit = async () => {
    // Построить объект для сохранения
    const instanceToSave = {
        name: editForm.value.name,
        userDataMark: editForm.value.userDataMark,
        workers: editForm.value.workers,
        // Если прокси включён — создать объект, иначе null
        proxy: editForm.value.proxy ? {
            enable: true,
            type: editForm.value.proxyType,
            host: editForm.value.proxyHost,
            port: editForm.value.proxyPort,
            auth: editForm.value.proxyAuth,
            username: editForm.value.proxyUsername,
            password: editForm.value.proxyPassword
        } : null
    };

    let newList = [...(instanceData.value || [])];
    if (editingInstance.value === null) {
        // Создание
        newList.push(instanceToSave);
    } else {
        // Обновить-Найти с уникальным идентификатором
        const editingKey = getInstanceKey(editingInstance.value);
        const index = newList.findIndex(item => getInstanceKey(item) === editingKey);
        if (index > -1) {
            newList[index] = instanceToSave;
        }
    }

    const success = await settingsStore.saveWorkerConfig(newList);
    if (success) {
        drawerOpen.value = false;
    }
};

// Индекс редактируемого Worker
const editingWorkerIndex = ref(-1);
const workerFormVisible = ref(false);
const workerForm = ref({
    name: '',
    type: 'lmarena',
    mergeTypes: [],
    mergeMonitor: ''
});

// Добавить Worker
const handleAddWorker = () => {
    editingWorkerIndex.value = -1;
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    workerForm.value = {
        name: `worker-${editForm.value.workers.length + 1}-${randomSuffix}`,
        type: 'lmarena',
        mergeTypes: [],
        mergeMonitor: ''
    };
    workerFormVisible.value = true;
};

// Редактировать Worker
const handleEditWorker = (index) => {
    editingWorkerIndex.value = index;
    const worker = editForm.value.workers[index];
    workerForm.value = {
        name: worker.name,
        type: worker.type,
        mergeTypes: worker.mergeTypes ? [...worker.mergeTypes] : [],
        mergeMonitor: worker.mergeMonitor || ''
    };
    workerFormVisible.value = true;
};

// Сохранить конфигурацию Worker
const handleSaveWorker = () => {
    if (editingWorkerIndex.value === -1) {
        // Добавление
        editForm.value.workers.push({ ...workerForm.value });
    } else {
        // Редактирование
        editForm.value.workers[editingWorkerIndex.value] = { ...workerForm.value };
    }
    workerFormVisible.value = false;
};

// Удалить Worker
const handleRemoveWorker = (index) => {
    editForm.value.workers.splice(index, 1);
};
</script>

<template>
    <a-layout style="background: transparent;">
        <a-card title="Балансировка нагрузки" :bordered="false" style="width: 100%; margin-bottom: 10px;">
            <!-- Стратегия планирования -->
            <div style="margin-bottom: 24px;">
                <div style="font-weight: 600; margin-bottom: 8px;">Стратегия</div>
                <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px;">
                    Алгоритм распределения задач по воркерам
                </div>
                <a-segmented v-model:value="poolConfig.strategy" block :options="[
                    { label: 'Наименее загруженный', value: 'least_busy' },
                    { label: 'Циклический', value: 'round_robin' },
                    { label: 'Случайный', value: 'random' }
                ]" />
            </div>

            <!-- Таймаут генерации -->
            <div style="margin-bottom: 24px;">
                <div style="font-weight: 600; margin-bottom: 8px;">Таймаут генерации</div>
                <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px;">
                    Максимальное время ожидания ответа AI, в секундах (по умолчанию 120)
                </div>
                <a-input-number v-model:value="poolConfig.waitTimeout" :min="30" :max="3600" :step="30"
                    style="width: 100%" placeholder="Введите секунды">
                    <template #addonAfter>с</template>
                </a-input-number>
            </div>

            <!-- Отказоустойчивость -->
            <div style="margin-bottom: 24px;">
                <a-collapse>
                    <a-collapse-panel key="failover" header="Отказоустойчивость">
                        <a-row :gutter="16">
                            <a-col :xs="24" :md="12">
                                <div style="margin-bottom: 8px;">
                                    <div style="font-weight: 600; margin-bottom: 8px;">Включить</div>
                                    <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px;">
                                        При ошибке задача автоматически переключится на другой доступный воркер
                                    </div>
                                    <a-switch v-model:checked="poolConfig.failover.enabled" />
                                </div>
                            </a-col>

                            <a-col :xs="24" :md="12">
                                <div style="margin-bottom: 8px;">
                                    <div style="font-weight: 600; margin-bottom: 8px;">Число попыток</div>
                                    <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px;">
                                        Максимальное число повторных попыток, 1-10
                                    </div>
                                    <a-input-number v-model:value="poolConfig.failover.maxRetries" :min="1" :max="10"
                                        :disabled="!poolConfig.failover.enabled" style="width: 100%" placeholder="Введите число попыток" />
                                </div>
                            </a-col>
                        </a-row>

                        <a-divider style="margin: 12px 0;" />

                        <a-row :gutter="16">
                            <a-col :xs="24" :md="12">
                                <div style="margin-bottom: 8px;">
                                    <div style="font-weight: 600; margin-bottom: 8px;">Повтор загрузки изображений</div>
                                    <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px;">
                                        При ошибке загрузки изображения/видео — повторить загрузку (без повторной генерации)
                                    </div>
                                    <a-switch v-model:checked="poolConfig.failover.imgDlRetry" />
                                </div>
                            </a-col>

                            <a-col :xs="24" :md="12">
                                <div style="margin-bottom: 8px;">
                                    <div style="font-weight: 600; margin-bottom: 8px;">Число попыток загрузки</div>
                                    <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px;">
                                        Максимальное число повторов при ошибке загрузки, 1-10
                                    </div>
                                    <a-input-number v-model:value="poolConfig.failover.imgDlRetryMaxRetries" :min="1"
                                        :max="10" :disabled="!poolConfig.failover.imgDlRetry" style="width: 100%"
                                        placeholder="Введите число попыток" />
                                </div>
                            </a-col>
                        </a-row>
                    </a-collapse-panel>
                </a-collapse>
            </div>

            <!-- Кнопка сохранения -->
            <div style="display: flex; justify-content: flex-end; margin-top: 24px;">
                <a-button type="primary" @click="handleSavePool">
                    Сохранить
                </a-button>
            </div>
        </a-card>


        <a-card :bordered="false" style="width: 100%;">
            <!-- Заголовок и кнопка создания -->
            <template #title>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span>Список экземпляров</span>
                    <a-space>
                        <a-button v-if="selectedRowKeys.length > 0" @click="openBatchProxy">
                            Настройить прокси ({{ selectedRowKeys.length }})
                        </a-button>
                        <a-button v-if="selectedRowKeys.length > 0" danger @click="handleBatchDelete">
                            Удалить ({{ selectedRowKeys.length }})
                        </a-button>
                        <a-button type="primary" @click="handleCreateInstance">
                            Создать экземпляр
                        </a-button>
                    </a-space>
                </div>
            </template>

            <!-- Таблица экземпляров -->
            <a-table :columns="columns" :data-source="instanceData" :pagination="false" :row-selection="rowSelection"
                row-key="id">
                <template #bodyCell="{ column, record }">
                    <!-- Имя экземпляра -->
                    <template v-if="column.key === 'name'">
                        <a>{{ record.name }}</a>
                    </template>

                    <!-- Количество воркеров -->
                    <template v-else-if="column.key === 'workerCount'">
                        {{ record.workers ? record.workers.length : 0 }}
                    </template>

                    <!-- Статус прокси -->
                    <template v-else-if="column.key === 'proxy'">
                        <a-tag :color="record.proxy ? 'green' : 'default'">
                            {{ record.proxy ? 'Включён' : 'Отключён' }}
                        </a-tag>
                    </template>

                    <!-- Действия -->
                    <template v-else-if="column.key === 'action'">
                        <span>
                            <a @click="handleEdit(record)">Изменить</a>
                            <a-divider type="vertical" />
                            <a style="color: #ff4d4f" @click="handleDelete(record)">Удалить</a>
                        </span>
                    </template>
                </template>
            </a-table>
        </a-card>

        <!-- Панель создания/редактирования -->
        <a-drawer v-model:open="drawerOpen"
            :title="editingInstance === null ? 'Создать экземпляр' : `Редактировать: ${editingInstance.name}`" placement="right" width="500">
            <div style="margin-bottom: 24px;">
                <!-- Имя экземпляра -->
                <div style="margin-bottom: 16px;">
                    <div style="font-weight: 600; margin-bottom: 4px;">Имя экземпляра</div>
                    <div style="font-size: 12px; color: #ff4d4f; margin-bottom: 8px;">
                        * Имя должно быть глобально уникальным
                    </div>
                    <a-input v-model:value="editForm.name" placeholder="Введите имя экземпляра" />
                </div>

                <!-- Метка данных -->
                <div style="margin-bottom: 16px;">
                    <div style="font-weight: 600; margin-bottom: 4px;">Метка данных</div>
                    <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px;">
                        Имя папки для данных этого экземпляра (userDataMark)
                    </div>
                    <a-input v-model:value="editForm.userDataMark" placeholder="Например: main-gemini" />
                </div>

                <!-- Настройки прокси -->
                <div style="margin-bottom: 16px;">
                    <a-collapse>
                        <a-collapse-panel key="proxy" header="Настройки прокси">
                            <!-- Включить прокси -->
                            <div style="margin-bottom: 16px;">
                                <a-switch v-model:checked="editForm.proxy" />
                                <span style="margin-left: 8px;">
                                    {{ editForm.proxy ? 'Прокси включён' : 'Прокси отключён' }}
                                </span>
                            </div>

                            <!-- Тип прокси -->
                            <div style="margin-bottom: 16px;" v-if="editForm.proxy">
                                <div style="font-weight: 600; margin-bottom: 8px;">Тип прокси</div>
                                <a-segmented v-model:value="editForm.proxyType" block :options="[
                                    { label: 'SOCKS5', value: 'socks5' },
                                    { label: 'HTTP', value: 'http' }
                                ]" style="width: 100%" />
                            </div>

                            <!-- Адрес сервера -->
                            <div style="margin-bottom: 16px;" v-if="editForm.proxy">
                                <div style="font-weight: 600; margin-bottom: 8px;">Адрес сервера</div>
                                <a-input v-model:value="editForm.proxyHost" placeholder="Например: 127.0.0.1" />
                            </div>

                            <!-- Порт -->
                            <div style="margin-bottom: 16px;" v-if="editForm.proxy">
                                <div style="font-weight: 600; margin-bottom: 8px;">Порт</div>
                                <a-input-number v-model:value="editForm.proxyPort" :min="1" :max="65535"
                                    style="width: 100%" placeholder="Например: 1080" />
                            </div>

                            <!-- Аутентификация -->
                            <div style="margin-bottom: 16px;" v-if="editForm.proxy">
                                <div style="font-weight: 600; margin-bottom: 8px;">Аутентификация</div>
                                <a-switch v-model:checked="editForm.proxyAuth" />
                                <span style="margin-left: 8px;">
                                    {{ editForm.proxyAuth ? 'Требуется' : 'Не требуется' }}
                                </span>
                            </div>

                            <!-- Имя пользователя -->
                            <div style="margin-bottom: 16px;" v-if="editForm.proxy && editForm.proxyAuth">
                                <div style="font-weight: 600; margin-bottom: 8px;">Имя пользователя</div>
                                <a-input v-model:value="editForm.proxyUsername" placeholder="Введите имя пользователя" />
                            </div>

                            <!-- Пароль -->
                            <div style="margin-bottom: 16px;" v-if="editForm.proxy && editForm.proxyAuth">
                                <div style="font-weight: 600; margin-bottom: 8px;">Пароль</div>
                                <a-input-password v-model:value="editForm.proxyPassword" placeholder="Введите пароль" />
                            </div>
                        </a-collapse-panel>
                    </a-collapse>
                </div>

                <!-- Список воркеров -->
                <div>
                    <div
                        style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <div style="font-weight: 600;">Воркеры</div>
                        <a-button size="small" type="primary" @click="handleAddWorker">
                            Добавить воркер
                        </a-button>
                    </div>
                    <a-list bordered :data-source="editForm.workers" style="margin-top: 8px;">
                        <template #renderItem="{ item, index }">
                            <a-list-item>
                                <template #actions>
                                    <a @click="handleEditWorker(index)">Изменить</a>
                                    <a style="color: #ff4d4f" @click="handleRemoveWorker(index)">Удалить</a>
                                </template>
                                <div>
                                    <div style="font-weight: 600;">{{ item.name }}</div>
                                    <div style="font-size: 12px; color: #8c8c8c;">
                                        Тип: {{ getAdapterDisplayName(item.type) }}
                                        <span v-if="item.type === 'merge'">
                                            | Агрегация: {{ item.mergeTypes?.map(getAdapterDisplayName).join(', ') || '无' }}
                                            <span v-if="item.mergeMonitor">
                                                | Мониторинг: {{ getAdapterDisplayName(item.mergeMonitor) }}
                                            </span>
                                        </span>
                                    </div>
                                </div>
                            </a-list-item>
                        </template>
                    </a-list>
                </div>
            </div>

            <!-- Кнопки внизу панели -->
            <template #footer>
                <div style="text-align: right;">
                    <a-button style="margin-right: 8px" @click="drawerOpen = false">Отмена</a-button>
                    <a-button type="primary" @click="handleSaveEdit">Сохранить</a-button>
                </div>
            </template>
        </a-drawer>

        <!-- Диалог конфигурации Worker -->
        <a-modal v-model:open="workerFormVisible" :title="editingWorkerIndex === -1 ? 'Добавить воркер' : 'Редактировать воркер'"
            okText="ОК" cancelText="Отмена" @ok="handleSaveWorker">
            <div style="margin-bottom: 16px;">
                <div style="font-weight: 600; margin-bottom: 4px;">Имя воркера</div>
                <div style="font-size: 12px; color: #ff4d4f; margin-bottom: 8px;">
                    * Имя должно быть глобально уникальным
                </div>
                <a-input v-model:value="workerForm.name" placeholder="Например: default" />
            </div>

            <div style="margin-bottom: 16px;">
                <div style="font-weight: 600; margin-bottom: 8px;">Тип адаптера</div>
                <a-select v-model:value="workerForm.type" style="width: 100%" :options="adapterOptions" />
            </div>

            <!-- Дополнительные параметры режима Merge -->
            <template v-if="workerForm.type === 'merge'">
                <div style="margin-bottom: 16px;">
                    <div style="font-weight: 600; margin-bottom: 4px;">Агрегируемые адаптеры</div>
                    <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px;">
                        Выберите адаптеры для агрегации (можно несколько)
                    </div>
                    <a-select v-model:value="workerForm.mergeTypes" mode="multiple" style="width: 100%"
                        placeholder="Выберите адаптеры" :options="mergeableAdapterOptions">
                    </a-select>
                </div>

                <div style="margin-bottom: 16px;">
                    <div style="font-weight: 600; margin-bottom: 4px;">Мониторинговый адаптер</div>
                    <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px;">
                        Адаптер для мониторинга в режиме ожидания (необязательно)
                    </div>
                    <a-select v-model:value="workerForm.mergeMonitor" style="width: 100%" placeholder="Выберите адаптер (необязательно)"
                        allow-clear>
                        <a-select-option value="">无</a-select-option>
                        <a-select-option v-for="type in workerForm.mergeTypes" :key="type" :value="type">
                            {{ getAdapterDisplayName(type) }}
                        </a-select-option>
                    </a-select>
                </div>
            </template>
        </a-modal>

        <!-- 批量代理设置模态框 -->
        <a-modal v-model:open="batchProxyVisible" title="批量设置代理" okText="确定" cancelText="取消"
            @ok="handleBatchProxySave">
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 16px;">
                将对选中的 {{ selectedRowKeys.length }} 个实例统一设置代理
            </div>
            <div style="margin-bottom: 16px;">
                <a-switch v-model:checked="batchProxyForm.proxy" />
                <span style="margin-left: 8px;">
                    {{ batchProxyForm.proxy ? '启用代理' : '禁用代理' }}
                </span>
            </div>

            <template v-if="batchProxyForm.proxy">
                <div style="margin-bottom: 16px;">
                    <div style="font-weight: 600; margin-bottom: 8px;">代理类型</div>
                    <a-segmented v-model:value="batchProxyForm.proxyType" block :options="[
                        { label: 'SOCKS5', value: 'socks5' },
                        { label: 'HTTP', value: 'http' }
                    ]" style="width: 100%" />
                </div>

                <div style="margin-bottom: 16px;">
                    <div style="font-weight: 600; margin-bottom: 8px;">服务器地址</div>
                    <a-input v-model:value="batchProxyForm.proxyHost" placeholder="例如: 127.0.0.1" />
                </div>

                <div style="margin-bottom: 16px;">
                    <div style="font-weight: 600; margin-bottom: 8px;">端口</div>
                    <a-input-number v-model:value="batchProxyForm.proxyPort" :min="1" :max="65535"
                        style="width: 100%" placeholder="例如: 1080" />
                </div>

                <div style="margin-bottom: 16px;">
                    <div style="font-weight: 600; margin-bottom: 8px;">身份验证</div>
                    <a-switch v-model:checked="batchProxyForm.proxyAuth" />
                    <span style="margin-left: 8px;">
                        {{ batchProxyForm.proxyAuth ? '需要验证' : '无需验证' }}
                    </span>
                </div>

                <div style="margin-bottom: 16px;" v-if="batchProxyForm.proxyAuth">
                    <div style="font-weight: 600; margin-bottom: 8px;">用户名</div>
                    <a-input v-model:value="batchProxyForm.proxyUsername" placeholder="请输入用户名" />
                </div>

                <div style="margin-bottom: 16px;" v-if="batchProxyForm.proxyAuth">
                    <div style="font-weight: 600; margin-bottom: 8px;">密码</div>
                    <a-input-password v-model:value="batchProxyForm.proxyPassword" placeholder="请输入密码" />
                </div>
            </template>
        </a-modal>
    </a-layout>
</template>
