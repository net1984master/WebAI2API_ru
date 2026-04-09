<script setup>
import { h, ref, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { useSystemStore } from '@/stores/system';
import { useSettingsStore } from '@/stores/settings';
import {
    PoweroffOutlined,
    CheckCircleOutlined,
    LoadingOutlined,
    ClockCircleOutlined,
    DeleteOutlined,
    FolderOutlined,
    StopOutlined,
    LoginOutlined,
    DownOutlined
} from '@ant-design/icons-vue';

const systemStore = useSystemStore();
const settingsStore = useSettingsStore();

// Текущее состояние шагов перезапуска
const currentStep = ref(0);
const restarting = ref(false);

// Определение шагов
const restartSteps = ref([
    {
        title: 'Подготовка',
        status: 'wait',
        icon: h(ClockCircleOutlined),
    },
    {
        title: 'Отправка команды',
        status: 'wait',
        icon: h(PoweroffOutlined),
    },
    {
        title: 'Ожидание',
        status: 'wait',
        icon: h(LoadingOutlined),
    },
    {
        title: 'Готово',
        status: 'wait',
        icon: h(CheckCircleOutlined),
    },
]);

// Панель папок экземпляров
const instanceDrawerOpen = ref(false);
const selectedFolders = ref([]);

// Список папок
const instanceFolders = ref([]);

// Состояние диалога перезапуска
const restartModalVisible = ref(false);

// Список воркеров (для выбора режима входа)
const workers = ref([]);

// Диалог подтверждения перезапуска
const restartConfirmVisible = ref(false);
const pendingRestartOptions = ref({});

// Получить список воркеров
const fetchWorkers = async () => {
    try {
        const res = await fetch('/admin/config/instances', {
            headers: settingsStore.getHeaders()
        });
        if (res.ok) {
            const instances = await res.json();
            // Извлечь воркеры из instances
            const allWorkers = [];
            for (const inst of instances) {
                for (const w of (inst.workers || [])) {
                    allWorkers.push({ name: w.name, instance: inst.name });
                }
            }
            workers.value = allWorkers;
        }
    } catch (e) {
        console.error('Ошибка получения списка воркеров', e);
    }
};

// Показать подтверждение
const showRestartConfirm = (options = {}) => {
    pendingRestartOptions.value = options;
    restartConfirmVisible.value = true;
};

// Подтвердить перезапуск
const confirmRestart = () => {
    restartConfirmVisible.value = false;
    handleRestart(pendingRestartOptions.value);
};

onMounted(() => {
    fetchWorkers();
});

// Утилита: задержка
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Выполнить перезапуск
const handleRestart = async (options = {}) => {
    restartModalVisible.value = true;
    restarting.value = true;
    currentStep.value = 0;

    // Шаг 1: подготовка
    restartSteps.value[0].status = 'process';
    await sleep(500);
    restartSteps.value[0].status = 'finish';
    currentStep.value = 1;

    // Шаг 2: отправка команды
    restartSteps.value[1].status = 'process';
    try {
        await systemStore.restartService(options);
        restartSteps.value[1].status = 'finish';
        currentStep.value = 2;
    } catch (e) {
        restartSteps.value[1].status = 'error';
        message.error('Нет соединения с сервером');
        return;
    }

    // Шаг 3: ожидание восстановления
    restartSteps.value[2].status = 'process';
    // Небольшая пауза для перезапуска
    await sleep(3000);
    let retries = 20;
    while (retries > 0) {
        try {
            await systemStore.fetchStatus();
            if (systemStore.status) {
                break;
            }
        } catch (e) {
            // ignore
        }
        await sleep(2000);
        retries--;
    }
    restartSteps.value[2].status = 'finish';
    currentStep.value = 3;

    // Шаг 4: завершено
    restartSteps.value[3].status = 'finish';

    message.success('Сервис перезапущен');

    // Закрыть диалог с задержкой
    setTimeout(() => {
        restartModalVisible.value = false;
        restarting.value = false;
        restartSteps.value.forEach(step => step.status = 'wait');
        currentStep.value = 0;
    }, 1500);
};

// Остановить сервис
const handleStop = async () => {
    try {
        const success = await systemStore.stopService();
        if (success) {
            message.success('Сервис остановлен');
        }
    } catch (e) {
        message.error('Ошибка остановки: ' + e.message);
    }
};

// Очистить кэш
const handleClearCache = async () => {
    try {
        const res = await fetch('/admin/cache/clear', {
            method: 'POST',
            headers: settingsStore.getHeaders()
        });
        if (res.ok) {
            message.success('Кэш очищен');
        } else {
            message.error('Ошибка очистки');
        }
    } catch (e) {
        message.error('Ошибка запроса: ' + e.message);
    }
};

// Открыть управление папками
const handleOpenInstanceDrawer = async () => {
    selectedFolders.value = [];
    instanceDrawerOpen.value = true;
    try {
        const res = await fetch('/admin/data-folders', {
            headers: settingsStore.getHeaders()
        });
        if (res.ok) {
            instanceFolders.value = await res.json();
        }
    } catch (e) {
        message.error('Ошибка получения списка папок');
    }
};

// Выбрать/снять выбор
const handleFolderSelect = (name, checked) => {
    if (checked) {
        if (!selectedFolders.value.includes(name)) {
            selectedFolders.value.push(name);
        }
    } else {
        selectedFolders.value = selectedFolders.value.filter(n => n !== name);
    }
};

// Удалить выбранные данные
const handleDeleteSelectedFolders = async () => {
    if (selectedFolders.value.length === 0) {
        message.warning('Сначала выберите папки для удаления');
        return;
    }

    try {
        const res = await fetch('/admin/data-folders/delete', {
            method: 'POST',
            headers: settingsStore.getHeaders(),
            body: JSON.stringify({ folders: selectedFolders.value })
        });

        if (res.ok) {
            message.success(`Удалено папок: ${selectedFolders.value.length}`);
            // Обновить список
            await handleOpenInstanceDrawer();
        } else {
            message.error('Ошибка удаления');
        }
    } catch (e) {
        message.error('Ошибка запроса на удаление');
    }
};
</script>

<template>
    <a-layout style="background: transparent;">
        <!-- Управление сервисом -->
        <a-card title="Управление сервисом" :bordered="false" style="width: 100%; margin-bottom: 10px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center;">
                    <div style="margin-right: 16px;">
                        <div style="font-weight: 600; margin-bottom: 4px;">Управление сервисом</div>
                        <div style="font-size: 12px; color: #8c8c8c;">
                            Управление состоянием сервера (перезапуск или остановка)
                        </div>
                    </div>
                </div>
                <div>
                    <a-space>
                        <!-- Кнопка перезапуска с меню -->
                        <a-dropdown-button type="primary" size="large" @click="showRestartConfirm()">
                            <PoweroffOutlined />
                            Перезапустить
                            <template #overlay>
                                <a-menu>
                                    <a-menu-item key="normal" @click="showRestartConfirm()">
                                        <PoweroffOutlined />
                                        Перезапустить
                                    </a-menu-item>
                                    <a-menu-divider />
                                    <a-menu-item key="login" @click="showRestartConfirm({ loginMode: true })">
                                        <LoginOutlined />
                                        Режим входа
                                    </a-menu-item>
                                    <a-sub-menu v-if="workers.length > 1" key="login-worker" title="Войти как воркер">
                                        <template #icon>
                                            <LoginOutlined />
                                        </template>
                                        <a-menu-item v-for="worker in workers" :key="worker.name"
                                            @click="showRestartConfirm({ loginMode: true, workerName: worker.name })">
                                            {{ worker.name }}
                                        </a-menu-item>
                                    </a-sub-menu>
                                </a-menu>
                            </template>
                        </a-dropdown-button>

                        <a-popconfirm ok-text="ОК" cancel-text="Отмена" @confirm="handleStop" placement="topRight">
                            <template #title>
                                <div style="width: 240px;">
                                    <div style="font-weight: 500; margin-bottom: 4px;">Остановить сервис?</div>
                                    <div style="font-size: 12px; color: #f5222d;">После остановки сервис потребует ручного запуска.</div>
                                </div>
                            </template>
                            <a-button type="primary" danger size="large">
                                <template #icon>
                                    <StopOutlined />
                                </template>
                                Остановить
                            </a-button>
                        </a-popconfirm>
                    </a-space>
                </div>
            </div>
        </a-card>

        <!-- Диалог подтверждения перезапуска -->
        <a-modal v-model:open="restartConfirmVisible" title="Подтверждение перезапуска" @ok="confirmRestart" ok-text="ОК" cancel-text="Отмена"
            :width="400">
            <div style="padding: 12px 0;">
                <p v-if="!pendingRestartOptions.loginMode">Перезапустить сервис?</p>
                <p v-else-if="pendingRestartOptions.workerName">
                    Перезапустить в <b>режиме входа</b>?<br />
                    <span style="color: #1890ff;">Только воркер: {{ pendingRestartOptions.workerName }}</span>
                </p>
                <p v-else>Перезапустить в <b>режиме входа</b>?</p>
            </div>
        </a-modal>

        <!-- Прогресс перезапуска -->
        <a-modal v-model:open="restartModalVisible" title="Перезапуск сервиса" :footer="null" :closable="false"
            :maskClosable="false" width="500px">
            <div style="padding: 24px 0;">
                <a-steps :current="currentStep" :items="restartSteps" />
                <div style="text-align: center; margin-top: 24px; color: #8c8c8c;">
                    Подождите, выполняется перезапуск...
                </div>
            </div>
        </a-modal>

        <!-- Управление кэшем -->
        <a-card title="Управление кэшем" :bordered="false" style="width: 100%;">
            <a-row :gutter="[16, 16]">
                <!-- Очистка кэша -->
                <a-col :xs="24" :md="12">
                    <a-card style="height: 100%;"
                        :body-style="{ display: 'flex', flexDirection: 'column', height: '100%' }">
                        <div style="flex: 1;">
                            <div style="display: flex; align-items: center; margin-bottom: 12px;">
                                <DeleteOutlined style="font-size: 24px; color: #1890ff; margin-right: 8px;" />
                                <div style="font-weight: 600; font-size: 16px;">Очистка кэша</div>
                            </div>
                            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 16px;">
                                Удаляет временные файлы, оставшиеся при ошибках (например, несохранённые изображения),<br>
                                Пользовательские данные не затрагиваются. <strong style="color: #ff4d4f;">Не запускайте при активных задачах</strong>
                            </div>
                        </div>
                        <a-popconfirm title="Очистить кэш?" ok-text="ОК" cancel-text="Отмена" @confirm="handleClearCache">
                            <a-button type="primary" block>
                                <template #icon>
                                    <DeleteOutlined />
                                </template>
                                Очистить кэш
                            </a-button>
                        </a-popconfirm>
                    </a-card>
                </a-col>

                <!-- Данные экземпляров -->
                <a-col :xs="24" :md="12">
                    <a-card style="height: 100%;"
                        :body-style="{ display: 'flex', flexDirection: 'column', height: '100%' }">
                        <div style="flex: 1;">
                            <div style="display: flex; align-items: center; margin-bottom: 12px;">
                                <FolderOutlined style="font-size: 24px; color: #ff4d4f; margin-right: 8px;" />
                                <div style="font-weight: 600; font-size: 16px;">Папки данных экземпляров</div>
                            </div>
                            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 16px;">
                                Удаляет папки с данными браузерных экземпляров,<br>
                                включая Cookie и локальное хранилище. <strong style="color: #ff4d4f;">Действуйте осторожно</strong>
                            </div>
                        </div>
                        <a-button danger block @click="handleOpenInstanceDrawer">
                            <template #icon>
                                <FolderOutlined />
                            </template>
                            Управление данными
                        </a-button>
                    </a-card>
                </a-col>
            </a-row>
        </a-card>

        <!-- Управление папками данных -->
        <a-drawer v-model:open="instanceDrawerOpen" title="Управление папками данных" placement="right" width="500">
            <div style="margin-bottom: 16px;">
                <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px;">
                    Выберите папки для удаления. Восстановление невозможно.
                </div>

                <!-- Список папок -->
                <a-list :data-source="instanceFolders" bordered>
                    <template #renderItem="{ item }">
                        <a-list-item>
                            <a-list-item-meta>
                                <template #title>
                                    <a-checkbox :checked="selectedFolders.includes(item.name)"
                                        @change="e => handleFolderSelect(item.name, e.target.checked)">
                                        {{ item.name }}
                                    </a-checkbox>
                                </template>
                                <template #description>
                                    <div style="font-size: 12px; margin-top: 4px;">
                                        <div>Путь: {{ item.path }}</div>
                                        <div>Экземпляр: {{ item.instance }}</div>
                                        <div>Размер: {{ item.size }}</div>
                                    </div>
                                </template>
                            </a-list-item-meta>
                        </a-list-item>
                    </template>
                </a-list>
            </div>

            <!-- Кнопки действий -->
            <template #footer>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="font-size: 12px; color: #8c8c8c;">
                        Выбрано: {{ selectedFolders.length }}
                    </div>
                    <div>
                        <a-button style="margin-right: 8px;" @click="instanceDrawerOpen = false">
                            Отмена
                        </a-button>
                        <a-popconfirm placement="topRight" ok-text="Удалить" cancel-text="Отмена"
                            @confirm="handleDeleteSelectedFolders">
                            <template #title>
                                <div style="white-space: nowrap;">
                                    Удалить выбранных папок: {{ selectedFolders.length }}?
                                </div>
                            </template>
                            <a-button type="primary" danger :disabled="selectedFolders.length === 0">
                                Удалить выбранные
                            </a-button>
                        </a-popconfirm>
                    </div>
                </div>
            </template>
        </a-drawer>
    </a-layout>
</template>
