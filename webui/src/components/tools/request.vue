<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import {
  ReloadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  FileTextOutlined,
  RocketOutlined,
  RedoOutlined,
  InboxOutlined,
  LoadingOutlined
} from '@ant-design/icons-vue';
import { message, Modal } from 'ant-design-vue';

const settingsStore = useSettingsStore();

// Состояние данных
const loading = ref(false);
const records = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(50);

// Состояние фильтрации
const dateRange = ref([]);
const statusFilter = ref('all');
const modelFilter = ref('');
const searchText = ref('');
const modelOptions = ref([]);

// Состояние множественного выбора
const selectedRowKeys = ref([]);
const selectedRows = ref([]);

// Статистика
const stats = ref({ total: 0, success: 0, failed: 0, avgDuration: 0 });

// Панель деталей
const drawerVisible = ref(false);
const currentRecord = ref(null);
const detailLoading = ref(false);

// Модальное окно быстрого просмотра
const previewModalVisible = ref(false);
const previewContent = ref('');
const previewMediaType = ref('text'); // text, image, video
const previewMediaUrl = ref('');

// Кэш медиаданных (blob URL)
const mediaCache = ref({});

// Параметры отправки запроса
const sendModelList = ref([]);
const sendModel = ref('');
const sendPrompt = ref('');
const sendImageList = ref([]);
const sendStreamMode = ref(false);
const sendReasoningMode = ref(true);
const sending = ref(false);

// Поддерживает ли текущая модель ввод изображений
const currentModelSupportsImage = computed(() => {
  if (!sendModel.value) return false;
  const model = sendModelList.value.find(m => m.id === sendModel.value);
  if (!model) return false;
  return model.image_policy !== 'forbidden';
});

// Автообновление
let autoRefreshInterval = null;

// Обнаружение мобильного устройства
const isMobile = ref(window.innerWidth <= 768);
let resizeHandler = null;

// Конфигурация статусов
const statusConfig = {
  success: { color: '#52c41a', text: 'Успешно', icon: CheckCircleOutlined },
  failed: { color: '#ff4d4f', text: 'Ошибка', icon: CloseCircleOutlined },
  pending: { color: '#faad14', text: 'Обработка', icon: ClockCircleOutlined }
};

// Получить историю
const fetchHistory = async () => {
  loading.value = true;
  try {
    const params = new URLSearchParams({
      page: page.value,
      pageSize: pageSize.value
    });

    if (statusFilter.value && statusFilter.value !== 'all') {
      params.append('status', statusFilter.value);
    }
    if (modelFilter.value) {
      params.append('model', modelFilter.value);
    }
    if (searchText.value) {
      params.append('search', searchText.value);
    }
    if (dateRange.value && dateRange.value.length === 2) {
      params.append('startDate', dateRange.value[0].format('YYYY-MM-DD'));
      params.append('endDate', dateRange.value[1].format('YYYY-MM-DD'));
    }

    const res = await fetch(`/admin/history?${params.toString()}`, {
      headers: settingsStore.getHeaders()
    });
    if (res.ok) {
      const data = await res.json();
      records.value = data.items || [];
      total.value = data.total || 0;
      // Предварительная загрузка миниатюр
      preloadThumbnails();
    }
  } catch (e) {
    message.error('Не удалось получить историю');
  } finally {
    loading.value = false;
  }
};

// Предварительно загрузить миниатюры в списке
const preloadThumbnails = async () => {
  for (const record of records.value) {
    if (record.responseMedia && record.responseMedia.length > 0) {
      const media = record.responseMedia[0];
      if (media.localPath && media.status === 'downloaded') {
        await getMediaBlobUrl(media);
      }
    }
  }
};

// Получить статистику
const fetchStats = async () => {
  try {
    const params = new URLSearchParams();
    if (dateRange.value && dateRange.value.length === 2) {
      params.append('startDate', dateRange.value[0].format('YYYY-MM-DD'));
      params.append('endDate', dateRange.value[1].format('YYYY-MM-DD'));
    }

    const res = await fetch(`/admin/history/stats?${params.toString()}`, {
      headers: settingsStore.getHeaders()
    });
    if (res.ok) {
      stats.value = await res.json();
    }
  } catch (e) {
    console.error('Не удалось получить статистику', e);
  }
};

// Получить список моделей
const fetchModels = async () => {
  try {
    const res = await fetch('/admin/history/models', {
      headers: settingsStore.getHeaders()
    });
    if (res.ok) {
      modelOptions.value = await res.json();
    }
  } catch (e) {
    console.error('Не удалось получить список моделей', e);
  }
};

// Просмотреть детали
const viewDetail = async (record) => {
  drawerVisible.value = true;
  detailLoading.value = true;
  try {
    const res = await fetch(`/admin/history/${record.id}`, {
      headers: settingsStore.getHeaders()
    });
    if (res.ok) {
      currentRecord.value = await res.json();
      // Предварительно загрузить медиа в деталях
      if (currentRecord.value.responseMedia) {
        for (const media of currentRecord.value.responseMedia) {
          if (media.localPath && media.status === 'downloaded') {
            await getMediaBlobUrl(media);
          }
        }
      }
    }
  } catch (e) {
    message.error('Не удалось получить детали');
  } finally {
    detailLoading.value = false;
  }
};

// Получить Blob URL медиа (с аутентификацией)
const getMediaBlobUrl = async (media) => {
  if (!media.localPath) return null;

  const filename = media.localPath.split('/').pop();
  const cacheKey = filename;

  // Проверить кэш
  if (mediaCache.value[cacheKey]) {
    return mediaCache.value[cacheKey];
  }

  try {
    const res = await fetch(`/admin/history/media/${filename}`, {
      headers: settingsStore.getHeaders()
    });
    if (res.ok) {
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      mediaCache.value[cacheKey] = blobUrl;
      return blobUrl;
    }
  } catch (e) {
    console.error('Не удалось получить медиа', e);
  }
  return null;
};

// Получить кэшированный URL медиа
const getCachedMediaUrl = (media) => {
  if (!media || !media.localPath) return null;
  const filename = media.localPath.split('/').pop();
  return mediaCache.value[filename] || null;
};

// Повторить загрузку медиа
const retryMedia = async (recordId, mediaIndex) => {
  try {
    const res = await fetch(`/admin/history/${recordId}/retry-media`, {
      method: 'POST',
      headers: {
        ...settingsStore.getHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ mediaIndex })
    });

    if (res.ok) {
      message.success('Загрузка успешна');
      fetchHistory();
      if (currentRecord.value && currentRecord.value.id === recordId) {
        viewDetail(currentRecord.value);
      }
    } else {
      const data = await res.json();
      message.error(data.message || 'Ошибка загрузки');
    }
  } catch (e) {
    message.error('Ошибка запроса');
  }
};

// Удалить записи
const deleteRecords = (ids) => {
  Modal.confirm({
    title: 'Подтвердить удаление',
    content: `Вы уверены, что хотите удалить ${ids.length} записей? Связанные медиафайлы также будут удалены.`,
    okText: 'Удалить',
    okType: 'danger',
    cancelText: 'Отмена',
    async onOk() {
      try {
        const res = await fetch('/admin/history', {
          method: 'DELETE',
          headers: {
            ...settingsStore.getHeaders(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ ids })
        });
        if (res.ok) {
          message.success('Удалено успешно');
          clearSelection();
          fetchHistory();
          fetchStats();
        } else {
          message.error('Ошибка удаления');
        }
      } catch (e) {
        message.error('Ошибка запроса');
      }
    }
  });
};

// Удалить по диапазону дат
const deleteByDateRange = () => {
  if (!dateRange.value || dateRange.value.length !== 2) {
    message.warning('Сначала выберите диапазон дат');
    return;
  }

  Modal.confirm({
    title: 'Подтвердить удаление',
    content: `Вы уверены, что хотите удалить все записи с ${dateRange.value[0].format('YYYY-MM-DD')} по ${dateRange.value[1].format('YYYY-MM-DD')}?`,
    okText: 'Удалить',
    okType: 'danger',
    cancelText: 'Отмена',
    async onOk() {
      try {
        const params = new URLSearchParams({
          startDate: dateRange.value[0].format('YYYY-MM-DD'),
          endDate: dateRange.value[1].format('YYYY-MM-DD')
        });
        const res = await fetch(`/admin/history?${params.toString()}`, {
          method: 'DELETE',
          headers: settingsStore.getHeaders()
        });
        if (res.ok) {
          const data = await res.json();
          message.success(`Удалено ${data.deleted} записей`);
          clearSelection();
          fetchHistory();
          fetchStats();
        } else {
          message.error('Ошибка удаления');
        }
      } catch (e) {
        message.error('Ошибка запроса');
      }
    }
  });
};

// Форматировать время
const formatTime = (timestamp) => {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  return date.toLocaleString('ru-RU', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Форматировать продолжительность
const formatDuration = (ms) => {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}мс`;
  return `${(ms / 1000).toFixed(1)}с`;
};

// Обрезать текст
const truncateText = (text, maxLen = 120) => {
  if (!text) return '-';
  return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
};

// Проверить, содержит ли ответ медиа
const hasMedia = (record) => {
  return record.responseMedia && record.responseMedia.length > 0;
};

// Получить первое медиа
const getFirstMedia = (record) => {
  if (!hasMedia(record)) return null;
  return record.responseMedia[0];
};

// Определение столбцов таблицы
const columns = [
  {
    title: 'Статус',
    dataIndex: 'status',
    key: 'status',
    width: 70,
    align: 'center'
  },
  {
    title: 'Промпт',
    dataIndex: 'prompt',
    key: 'prompt',
    width: 200
  },
  {
    title: 'Модель',
    dataIndex: 'model_name',
    key: 'model_name',
    width: 150,
    ellipsis: true
  },
  {
    title: 'Ответ',
    key: 'response',
    width: 220
  },
  {
    title: 'Медиа',
    key: 'media',
    width: 180,
    align: 'center'
  },
  {
    title: 'Время',
    dataIndex: 'created_at',
    key: 'created_at',
    width: 100,
    customRender: ({ value }) => formatTime(value)
  },
  {
    title: 'Длительность',
    dataIndex: 'duration_ms',
    key: 'duration_ms',
    width: 60,
    align: 'right',
    customRender: ({ value }) => formatDuration(value)
  },
  {
    title: '',
    key: 'action',
    width: 100,
    align: 'center',
    fixed: 'right'
  }
];

// Наблюдать за изменениями фильтров
watch([statusFilter, modelFilter, dateRange], () => {
  page.value = 1;
  fetchHistory();
  fetchStats();
});

// При смене модели очистить выбранные изображения
watch(sendModel, () => {
  sendImageList.value = [];
});

// Поиск с задержкой
let searchTimeout = null;
watch(searchText, () => {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    page.value = 1;
    fetchHistory();
  }, 300);
});

// Изменение пагинации
const handleTableChange = (pagination) => {
  page.value = pagination.current;
  pageSize.value = pagination.pageSize;
  clearSelection();
  fetchHistory();
};

// Обновить
const handleRefresh = () => {
  fetchHistory();
  fetchModels();
};

// Быстрый просмотр содержимого ответа
const previewResponse = async (record) => {
  previewModalVisible.value = true;
  previewMediaType.value = 'text';
  if (record.status === 'failed') {
    previewContent.value = record.error_message || 'Неизвестная ошибка';
  } else {
    previewContent.value = record.response_text || 'Нет ответа';
  }
};

// Быстрый просмотр медиа
const previewMedia = async (record) => {
  const media = getFirstMedia(record);
  if (!media) return;

  if (media.type === 'image') {
    previewMediaType.value = 'image';
  } else if (media.type === 'video') {
    previewMediaType.value = 'video';
  } else {
    previewMediaType.value = 'text';
    previewContent.value = media.originalUrl || 'Нет предпросмотра';
    previewModalVisible.value = true;
    return;
  }

  if (media.status === 'downloaded') {
    const url = await getMediaBlobUrl(media);
    if (url) {
      previewMediaUrl.value = url;
      previewModalVisible.value = true;
    } else {
      message.error('Ошибка загрузки предпросмотра');
    }
  } else {
    previewContent.value = 'Медиа не загружено или загрузка не удалась, проверьте детали и повторите попытку';
    previewMediaType.value = 'text';
    previewModalVisible.value = true;
  }
};

// Закрыть окно предпросмотра
const closePreview = () => {
  previewModalVisible.value = false;
  previewContent.value = '';
  previewMediaUrl.value = '';
  previewMediaType.value = 'text';
};

// Изменение множественного выбора
const onSelectChange = (keys, rows) => {
  selectedRowKeys.value = keys;
  selectedRows.value = rows;
};

// Удалить выбранные записи
const deleteSelected = () => {
  if (selectedRowKeys.value.length === 0) {
    message.warning('Сначала выберите записи для удаления');
    return;
  }
  deleteRecords(selectedRowKeys.value);
};

// Очистить выбор
const clearSelection = () => {
  selectedRowKeys.value = [];
  selectedRows.value = [];
};

// === Функция отправки запроса ===

// Получить список доступных моделей
const fetchSendModelList = async () => {
  try {
    const res = await fetch('/v1/models', { headers: settingsStore.getHeaders() });
    if (res.ok) {
      const data = await res.json();
      sendModelList.value = data.data || [];
      if (sendModelList.value.length > 0 && !sendModel.value) {
        sendModel.value = sendModelList.value[0].id;
      }
    }
  } catch (e) {
    console.error('Не удалось получить список моделей', e);
  }
};

// Преобразовать изображение в base64
const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
  });
};

// Проверка перед загрузкой изображения
const beforeUpload = (file) => {
  const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    message.error('Поддерживаются только форматы PNG, JPEG, GIF, WebP');
    return false;
  }
  if (sendImageList.value.length >= 10) {
    message.error('Можно загрузить максимум 10 изображений');
    return false;
  }
  return false;
};

// Обработать выбор изображения
const handleSendImageChange = async (info) => {
  const file = info.file;
  if (file.status === 'removed') {
    sendImageList.value = sendImageList.value.filter(f => f.uid !== file.uid);
    return;
  }
  try {
    const base64 = await fileToBase64(file.originFileObj || file);
    sendImageList.value.push({ uid: file.uid, name: file.name, base64 });
  } catch (e) {
    message.error('Ошибка чтения изображения');
  }
};

// Отправить запрос (fire-and-forget, не блокирует UI)
const sendRequest = () => {
  if (!sendModel.value) {
    message.warning('Выберите модель');
    return;
  }
  if (!sendPrompt.value.trim()) {
    message.warning('Введите промпт');
    return;
  }

  let content;
  if (sendImageList.value.length > 0) {
    content = [{ type: 'text', text: sendPrompt.value }];
    for (const img of sendImageList.value) {
      content.push({ type: 'image_url', image_url: { url: img.base64 } });
    }
  } else {
    content = sendPrompt.value;
  }

  const body = {
    model: sendModel.value,
    messages: [{ role: 'user', content }],
    stream: sendStreamMode.value
  };
  if (sendReasoningMode.value) {
    body.reasoning = true;
  }

  // Отправить и не ждать ответа
  fetch('/v1/chat/completions', {
    method: 'POST',
    headers: { ...settingsStore.getHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).catch(() => { /* Тихо обрабатывать сетевые ошибки, список покажет статус ошибки */ });

  message.success('Запрос отправлен');

  // Очистить ввод, чтобы можно было сразу отправить следующий
  sendPrompt.value = '';
  sendImageList.value = [];

  // Запустить автообновление + обновить через 1 секунду для быстрого отображения новой записи
  startAutoRefresh();
  setTimeout(() => {
    silentFetchHistory();
    silentFetchStats();
  }, 1000);
};

// Повторно отправить из истории
const resendFromRecord = (record) => {
  const modelId = record.model_id || record.model_name;
  if (modelId) {
    sendModel.value = modelId;
  }
  if (record.prompt) {
    sendPrompt.value = record.prompt;
  }
  sendImageList.value = [];
  sendRequest();
};

// === Автообновление ===
const silentFetchHistory = async () => {
  try {
    const params = new URLSearchParams({ page: page.value, pageSize: pageSize.value });
    if (statusFilter.value && statusFilter.value !== 'all') params.append('status', statusFilter.value);
    if (modelFilter.value) params.append('model', modelFilter.value);
    if (searchText.value) params.append('search', searchText.value);
    if (dateRange.value && dateRange.value.length === 2) {
      params.append('startDate', dateRange.value[0].format('YYYY-MM-DD'));
      params.append('endDate', dateRange.value[1].format('YYYY-MM-DD'));
    }
    const res = await fetch(`/admin/history?${params.toString()}`, { headers: settingsStore.getHeaders() });
    if (res.ok) {
      const data = await res.json();
      records.value = data.items || [];
      total.value = data.total || 0;
      preloadThumbnails();
    }
  } catch (e) { /* Тихо игнорировать ошибки */ }
};

const silentFetchStats = async () => {
  try {
    const params = new URLSearchParams();
    if (dateRange.value && dateRange.value.length === 2) {
      params.append('startDate', dateRange.value[0].format('YYYY-MM-DD'));
      params.append('endDate', dateRange.value[1].format('YYYY-MM-DD'));
    }
    const res = await fetch(`/admin/history/stats?${params.toString()}`, { headers: settingsStore.getHeaders() });
    if (res.ok) { stats.value = await res.json(); }
  } catch (e) { /* Тихо игнорировать ошибки */ }
};

const startAutoRefresh = () => {
  if (autoRefreshInterval) return;
  autoRefreshInterval = setInterval(() => {
    silentFetchHistory();
    silentFetchStats();
  }, 5000);
};

const stopAutoRefresh = () => {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
};

onMounted(() => {
  resizeHandler = () => { isMobile.value = window.innerWidth <= 768; };
  window.addEventListener('resize', resizeHandler);
  fetchHistory();
  fetchStats();
  fetchModels();
  fetchSendModelList();
});

onUnmounted(() => {
  stopAutoRefresh();
  if (resizeHandler) window.removeEventListener('resize', resizeHandler);
});
</script>

<template>
  <!-- Отправить запрос -->
  <a-card title="Отправить запрос" :bordered="false" style="margin-bottom: 24px">
    <div style="display: flex; gap: 16px; flex-wrap: wrap;">
      <!-- Левая часть: модель + промпт -->
      <div style="flex: 1; min-width: 280px;">
        <!-- Выбор модели -->
        <div style="margin-bottom: 12px;">
          <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 4px;">Модель</div>
          <a-select v-model:value="sendModel" style="width: 100%" size="small" placeholder="Выберите модель" show-search>
            <a-select-option v-for="model in sendModelList" :key="model.id" :value="model.id">
              {{ model.id }}
            </a-select-option>
          </a-select>
        </div>

        <!-- Промпт -->
        <div style="margin-bottom: 12px;">
          <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 4px;">Промпт</div>
          <a-textarea v-model:value="sendPrompt" placeholder="Введите промпт" :rows="3" size="small" />
        </div>

        <!-- Опции + кнопка отправки -->
        <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
          <a-checkbox v-model:checked="sendStreamMode">Потоковый ответ</a-checkbox>
          <a-checkbox v-model:checked="sendReasoningMode">Вернуть рассуждения</a-checkbox>
          <a-button type="primary" @click="sendRequest" :disabled="!sendModel">
            <template #icon><RocketOutlined /></template>
            Отправить
          </a-button>
        </div>
      </div>

      <!-- Правая часть: загрузка изображений (отображается только для моделей, поддерживающих изображения) -->
      <div v-if="currentModelSupportsImage" class="send-upload-area">
        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 4px;">
          Дополнительные изображения ({{ sendImageList.length }}/10)
        </div>
        <a-upload-dragger :file-list="[]" :multiple="true" :before-upload="beforeUpload"
                          @change="handleSendImageChange" accept=".png,.jpg,.jpeg,.gif,.webp" :show-upload-list="false">
          <p style="margin: 0;">
            <InboxOutlined style="font-size: 20px; color: #1890ff;" />
          </p>
          <p style="font-size: 12px; margin: 2px 0 0 0; color: #8c8c8c;">
            Нажмите или перетащите изображения для загрузки
          </p>
        </a-upload-dragger>
        <div v-if="sendImageList.length > 0" style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px;">
          <a-tag v-for="img in sendImageList" :key="img.uid" closable
                 @close="sendImageList = sendImageList.filter(i => i.uid !== img.uid)">
            <PictureOutlined /> {{ img.name.slice(0, 15) }}{{ img.name.length > 15 ? '...' : '' }}
          </a-tag>
        </div>
      </div>
    </div>
  </a-card>

  <!-- Статистика -->
  <a-card title="История запросов" :bordered="false">
    <template #extra>
      <a-button type="link" danger size="small" @click="deleteByDateRange"
                :disabled="!dateRange || dateRange.length !== 2">
        <template #icon>
          <DeleteOutlined />
        </template>
        Удалить выбранный диапазон
      </a-button>
    </template>

    <div class="stats-content">
      <a-range-picker v-model:value="dateRange" :format="'YYYY-MM-DD'" :placeholder="['Дата начала', 'Дата окончания']"
                      size="small" class="stats-date-picker" />

      <a-divider type="vertical" style="height: 32px; margin: 0 16px" />

      <div class="stats-numbers">
        <div class="stat-item neutral">
          <FileTextOutlined />
          <span class="stat-value">{{ stats.total }}</span>
          <span class="stat-label">Всего</span>
        </div>
        <div class="stat-item success">
          <CheckCircleOutlined />
          <span class="stat-value">{{ stats.success }}</span>
          <span class="stat-label">Успешно</span>
        </div>
        <div class="stat-item error">
          <CloseCircleOutlined />
          <span class="stat-value">{{ stats.failed }}</span>
          <span class="stat-label">Ошибки</span>
        </div>
        <div class="stat-item neutral">
          <ClockCircleOutlined />
          <span class="stat-value">{{ formatDuration(stats.avgDuration) }}</span>
          <span class="stat-label">Среднее время</span>
        </div>
      </div>
    </div>
  </a-card>

  <!-- Таблица истории -->
  <a-card :bordered="false" style="margin-top: 24px">
    <!-- Панель фильтров -->
    <div class="toolbar">
      <div class="toolbar-row">
        <a-select v-model:value="statusFilter" class="toolbar-status-select" size="small" placeholder="Статус">
          <a-select-option value="all">Все статусы</a-select-option>
          <a-select-option value="success">Успешно</a-select-option>
          <a-select-option value="failed">Ошибка</a-select-option>
          <a-select-option value="pending">Обработка</a-select-option>
        </a-select>
        <a-select v-model:value="modelFilter" class="toolbar-model-select" size="small" placeholder="Все модели"
                  allow-clear show-search>
          <a-select-option v-for="model in modelOptions" :key="model" :value="model">
            {{ model }}
          </a-select-option>
        </a-select>
        <a-button size="small" @click="handleRefresh">
          <template #icon>
            <ReloadOutlined />
          </template>
        </a-button>
        <a-button v-if="selectedRowKeys.length > 0" type="primary" danger size="small" @click="deleteSelected">
          <template #icon>
            <DeleteOutlined />
          </template>
          Удалить выбранное ({{ selectedRowKeys.length }})
        </a-button>
      </div>
      <div class="toolbar-row">
        <a-input-search v-model:value="searchText" placeholder="Поиск по промпту или содержимому ответа" size="small"
                        allow-clear style="width: 100%;" />
      </div>
    </div>

    <!-- Таблица -->
    <a-table
        :columns="columns"
        :data-source="records"
        :loading="loading"
        :row-selection="{
                selectedRowKeys: selectedRowKeys,
                onChange: onSelectChange,
                columnWidth: 40
            }"
        :pagination="{
                current: page,
                pageSize: pageSize,
                total: total,
                showSizeChanger: true,
                showQuickJumper: true,
                showTotal: (total) => `Всего ${total}`,
                pageSizeOptions: ['20', '50', '100', '200']
            }"
        row-key="id"
        size="small"
        :scroll="{ x: 1000 }"
        @change="handleTableChange"
    >
      <template #bodyCell="{ column, record }">
        <!-- Колонка промпта: поддержка многострочного текста -->
        <template v-if="column.key === 'prompt'">
          <div class="multiline-text">
            {{ truncateText(record.prompt, 120) }}
          </div>
        </template>

        <!-- Колонка ответа -->
        <template v-else-if="column.key === 'response'">
          <div v-if="record.status === 'failed'" class="multiline-text error-text clickable"
               @click="previewResponse(record)" title="Нажмите для просмотра полного содержимого">
            {{ truncateText(record.error_message, 120) || 'Ошибка' }}
          </div>
          <div v-else class="multiline-text response-text clickable"
               @click="previewResponse(record)" title="Нажмите для просмотра полного содержимого">
            {{ truncateText(record.response_text, 120) || '-' }}
          </div>
        </template>

        <!-- Колонка медиа: отображение миниатюр -->
        <template v-else-if="column.key === 'media'">
          <div v-if="hasMedia(record)" class="media-thumb-cell" @click="previewMedia(record)" title="Нажмите для просмотра">
            <template v-if="getFirstMedia(record).status === 'downloaded'">
              <img
                  v-if="getFirstMedia(record).type === 'image'"
                  :src="getCachedMediaUrl(getFirstMedia(record))"
                  class="thumb-img"
                  loading="lazy"
              />
              <div v-else-if="getFirstMedia(record).type === 'video'" class="thumb-video">
                <PlayCircleOutlined />
              </div>
            </template>
            <div v-else class="thumb-placeholder">
              <PictureOutlined v-if="getFirstMedia(record).type === 'image'" />
              <PlayCircleOutlined v-else />
            </div>
            <span v-if="record.responseMedia.length > 1" class="media-count">
                            +{{ record.responseMedia.length - 1 }}
                        </span>
          </div>
          <span v-else class="no-media">-</span>
        </template>

        <!-- Колонка статуса -->
        <template v-else-if="column.key === 'status'">
          <a-tag :color="statusConfig[record.status]?.color || '#8c8c8c'" size="small">
            {{ statusConfig[record.status]?.text || record.status }}
          </a-tag>
        </template>

        <!-- Колонка действий -->
        <template v-else-if="column.key === 'action'">
          <a-space :size="0">
            <a-tooltip title="Повторить">
              <a-button type="link" size="small" @click="resendFromRecord(record)">
                <template #icon>
                  <RedoOutlined />
                </template>
              </a-button>
            </a-tooltip>
            <a-tooltip title="Детали">
              <a-button type="link" size="small" @click="viewDetail(record)">
                <template #icon>
                  <EyeOutlined />
                </template>
              </a-button>
            </a-tooltip>
            <a-tooltip title="Удалить">
              <a-button type="link" size="small" danger @click="deleteRecords([record.id])">
                <template #icon>
                  <DeleteOutlined />
                </template>
              </a-button>
            </a-tooltip>
          </a-space>
        </template>
      </template>
    </a-table>
  </a-card>

  <!-- Панель деталей -->
  <a-drawer v-model:open="drawerVisible" title="Детали запроса" placement="right" :width="isMobile ? '100%' : 700" :destroy-on-close="true">
    <a-spin :spinning="detailLoading">
      <template v-if="currentRecord">
        <!-- Основная информация -->
        <a-descriptions :column="isMobile ? 1 : 2" size="small" bordered>
          <a-descriptions-item label="ID запроса" :span="2">
            <code>{{ currentRecord.id }}</code>
          </a-descriptions-item>
          <a-descriptions-item label="Время">
            {{ new Date(currentRecord.created_at).toLocaleString('ru-RU') }}
          </a-descriptions-item>
          <a-descriptions-item label="Статус">
            <a-tag :color="statusConfig[currentRecord.status]?.color">
              {{ statusConfig[currentRecord.status]?.text || currentRecord.status }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="Модель" :span="2">
            {{ currentRecord.model_name || currentRecord.model_id || '-' }}
          </a-descriptions-item>
          <a-descriptions-item label="Длительность">
            {{ formatDuration(currentRecord.duration_ms) }}
          </a-descriptions-item>
          <a-descriptions-item label="Потоковый режим">
            {{ currentRecord.isStreaming ? 'Да' : 'Нет' }}
          </a-descriptions-item>
        </a-descriptions>

        <!-- Промпт -->
        <a-divider orientation="left">Промпт</a-divider>
        <div class="content-box">
          {{ currentRecord.prompt || 'Нет' }}
        </div>

        <!-- Входные изображения -->
        <template v-if="currentRecord.inputImages && currentRecord.inputImages.length > 0">
          <a-divider orientation="left">Входные изображения</a-divider>
          <div class="media-list">
                        <span v-for="(img, idx) in currentRecord.inputImages" :key="idx" class="media-item">
                            <a-tag>{{ img.split('/').pop() }}</a-tag>
                        </span>
          </div>
        </template>

        <!-- Содержимое ответа -->
        <a-divider orientation="left">Содержимое ответа</a-divider>
        <div class="content-box" :class="{ 'error-box': currentRecord.status === 'failed' }">
          <template v-if="currentRecord.status === 'failed'">
            {{ currentRecord.error_message || 'Неизвестная ошибка' }}
          </template>
          <template v-else>
            {{ currentRecord.response_text || 'Нет ответа' }}
          </template>
        </div>

        <!-- Процесс рассуждения -->
        <template v-if="currentRecord.reasoning_content">
          <a-divider orientation="left">Процесс рассуждения</a-divider>
          <div class="content-box reasoning-box">
            {{ currentRecord.reasoning_content }}
          </div>
        </template>

        <!-- Медиа контент -->
        <template v-if="currentRecord.responseMedia && currentRecord.responseMedia.length > 0">
          <a-divider orientation="left">Медиа контент ({{ currentRecord.responseMedia.length }})</a-divider>
          <div class="media-gallery-large">
            <div v-for="(media, idx) in currentRecord.responseMedia" :key="idx" class="media-card-large">
              <div class="media-preview-large">
                <template v-if="media.status === 'downloaded' && getCachedMediaUrl(media)">
                  <img v-if="media.type === 'image'" :src="getCachedMediaUrl(media)" alt="Сгенерированное изображение" />
                  <video v-else-if="media.type === 'video'" :src="getCachedMediaUrl(media)" controls />
                </template>
                <template v-else>
                  <div class="media-placeholder-large">
                    <PictureOutlined v-if="media.type === 'image'" />
                    <PlayCircleOutlined v-else-if="media.type === 'video'" />
                    <FileTextOutlined v-else />
                    <div class="media-status">
                      <a-tag v-if="media.status === 'failed'" color="red">Ошибка загрузки</a-tag>
                      <a-tag v-else-if="media.status === 'external'" color="blue">Внешняя ссылка</a-tag>
                      <a-tag v-else-if="media.status === 'pending'" color="orange">Ожидает загрузки</a-tag>
                    </div>
                    <a-button v-if="media.status === 'failed'" type="primary" size="small"
                              @click="retryMedia(currentRecord.id, idx)">
                      <template #icon>
                        <ReloadOutlined />
                      </template>
                      Повторить загрузку
                    </a-button>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </template>
      </template>
    </a-spin>
  </a-drawer>

  <!-- Модальное окно быстрого просмотра -->
  <a-modal
      v-model:open="previewModalVisible"
      :footer="null"
      :width="isMobile ? '95%' : (previewMediaType === 'image' || previewMediaType === 'video' ? '90%' : '70%')"
      centered
      @cancel="closePreview"
  >
    <template #title>
      <span>Быстрый просмотр</span>
    </template>
    <div v-if="previewMediaType === 'text'" class="preview-text-content">
      {{ previewContent }}
    </div>
    <div v-else-if="previewMediaType === 'image'" class="preview-image-content">
      <img :src="previewMediaUrl" alt="Предпросмотр изображения" />
    </div>
    <div v-else-if="previewMediaType === 'video'" class="preview-video-content">
      <video :src="previewMediaUrl" controls autoplay />
    </div>
  </a-modal>
</template>

<style scoped>
/* Контроль высоты области загрузки изображений */
.send-upload-area :deep(.ant-upload-drag) {
  height: calc(100% - 20px);
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

/* Стили панели инструментов */
.toolbar {
  margin-bottom: 16px;
}

.toolbar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.toolbar-row:last-child {
  margin-bottom: 0;
}

/* Ширина select по умолчанию */
.toolbar-status-select {
  width: 100px;
}

.toolbar-model-select {
  width: 200px;
}

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

/* Стили внутри таблицы */
.error-text {
  color: #ff4d4f;
  font-size: 12px;
}

.response-text {
  font-size: 12px;
  color: #595959;
}

/* Многострочный текст */
.multiline-text {
  font-size: 12px;
  line-height: 1.5;
  max-height: 54px;  /* Примерно 3 строки */
  overflow: hidden;
  word-break: break-all;
}

.multiline-text.clickable {
  cursor: pointer;
  padding: 4px;
  margin: -4px;
  border-radius: 4px;
  transition: background 0.2s;
}

.multiline-text.clickable:hover {
  background: #f0f0f0;
}

.no-media {
  color: #bfbfbf;
}

/* Выравнивание высоты строк таблицы для больших миниатюр */
:deep(.ant-table-tbody > tr > td) {
  vertical-align: middle;
}

/* Миниатюры в списке - 160x160 */
.media-thumb-cell {
  position: relative;
  width: 160px;
  height: 160px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 8px auto;
}

.thumb-img {
  width: 160px;
  height: 160px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid #f0f0f0;
}

.thumb-video {
  width: 160px;
  height: 160px;
  background: #000;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 28px;
}

.thumb-placeholder {
  width: 160px;
  height: 160px;
  background: #fafafa;
  border: 1px dashed #d9d9d9;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #bfbfbf;
  font-size: 24px;
}

.media-count {
  position: absolute;
  bottom: 4px;
  right: 4px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 3px;
}

/* Стили блока содержимого */
.content-box {
  background: #fafafa;
  border: 1px solid #f0f0f0;
  border-radius: 4px;
  padding: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 600px;
  overflow-y: auto;
}

.content-box.error-box {
  color: #ff4d4f;
  background: #fff2f0;
  border-color: #ffccc7;
}

.content-box.reasoning-box {
  background: #f6ffed;
  border-color: #b7eb8f;
  color: #389e0d;
}

/* Стили медиа на странице деталей - больший размер */
.media-gallery-large {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.media-card-large {
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  overflow: hidden;
  background: #fafafa;
}

.media-preview-large {
  width: 100%;
  min-height: 300px;
  max-height: 500px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
}

.media-preview-large img {
  max-width: 100%;
  max-height: 500px;
  object-fit: contain;
}

.media-preview-large video {
  max-width: 100%;
  max-height: 500px;
}

.media-placeholder-large {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #bfbfbf;
  gap: 12px;
  padding: 40px;
  font-size: 48px;
}

.media-status {
  font-size: 14px;
}

/* Список медиа */
.media-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* Содержимое модального окна предпросмотра */
.preview-text-content {
  background: #fafafa;
  border: 1px solid #f0f0f0;
  border-radius: 4px;
  padding: 16px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 14px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 60vh;
  overflow-y: auto;
  line-height: 1.6;
}

.preview-image-content {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 200px;
}

.preview-image-content img {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
  border-radius: 4px;
}

.preview-video-content {
  display: flex;
  justify-content: center;
  align-items: center;
}

.preview-video-content video {
  max-width: 100%;
  max-height: 70vh;
  border-radius: 4px;
}

/* Размеры области загрузки изображений */
.send-upload-area {
  flex: 0 0 280px;
  min-width: 200px;
}

/* Выбор даты */
.stats-date-picker {
  width: 240px;
}

/* Адаптивный дизайн - планшеты и ниже */
@media (max-width: 768px) {
  .send-upload-area {
    flex: 1 1 100% !important;
    min-width: 0 !important;
  }

  .stats-date-picker {
    width: 100%;
  }

  .media-thumb-cell {
    width: 80px;
    height: 80px;
  }

  .thumb-img {
    width: 80px;
    height: 80px;
  }

  .thumb-video {
    width: 80px;
    height: 80px;
    font-size: 20px;
  }

  .thumb-placeholder {
    width: 80px;
    height: 80px;
    font-size: 18px;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .toolbar-row {
    flex-wrap: nowrap;
    margin-bottom: 0;
    gap: 4px;
  }

  .toolbar-row:last-child {
    flex: 1;
    min-width: 100px;
  }

  .toolbar-status-select {
    width: 80px !important;
  }

  .toolbar-model-select {
    width: 100px !important;
  }

  .stat-value {
    font-size: 14px;
  }

  .stat-item {
    padding: 2px 8px;
  }

  .content-box {
    max-height: 400px;
    font-size: 12px;
    padding: 8px;
  }

  .media-preview-large {
    min-height: 200px;
    max-height: 350px;
  }
}

/* Адаптивный дизайн - телефоны */
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
    flex-wrap: wrap;
    gap: 8px;
  }

  .stat-item {
    padding: 2px 6px;
    gap: 4px;
  }

  .stat-value {
    font-size: 13px;
  }

  .stat-label {
    font-size: 11px;
  }
}
</style>