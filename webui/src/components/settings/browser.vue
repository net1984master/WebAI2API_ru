<script setup>
import { onMounted, reactive } from 'vue';
import { useSettingsStore } from '@/stores/settings';

const settingsStore = useSettingsStore();

// Данные формы
const formData = reactive({
    path: '',
    headless: false,
    fission: true,
    humanizeCursor: false, // false | true | 'camou'
    // CSS-оптимизация
    cssAnimation: false,
    cssFilter: false,
    cssFont: false,
    // Глобальный прокси
    proxyEnable: false,
    proxyType: 'http',
    proxyHost: '127.0.0.1',
    proxyPort: 7890,
    proxyAuth: false,
    proxyUser: '',
    proxyPasswd: ''
});

onMounted(async () => {
    await settingsStore.fetchBrowserConfig();
    const cfg = settingsStore.browserConfig || {};
    formData.path = cfg.path || '';
    formData.headless = cfg.headless || false;
    formData.fission = cfg.fission !== false; // по умолчанию true
    // humanizeCursor: false=禁用, true=ghost-cursor, 'camou'=Camoufox内置
    formData.humanizeCursor = cfg.humanizeCursor ?? false;

    // CSS-оптимизация
    if (cfg.cssInject) {
        formData.cssAnimation = cfg.cssInject.animation || false;
        formData.cssFilter = cfg.cssInject.filter || false;
        formData.cssFont = cfg.cssInject.font || false;
    }

    if (cfg.proxy) {
        formData.proxyEnable = cfg.proxy.enable || false;
        formData.proxyType = cfg.proxy.type || 'http';
        formData.proxyHost = cfg.proxy.host || '';
        formData.proxyPort = cfg.proxy.port || 7890;
        formData.proxyAuth = cfg.proxy.auth || false;
        formData.proxyUser = cfg.proxy.username || '';
        formData.proxyPasswd = cfg.proxy.password || '';
    }
});

// Сохранить настройки
const handleSave = async () => {
    const config = {
        path: formData.path,
        headless: formData.headless,
        cssInject: {
            animation: formData.cssAnimation,
            filter: formData.cssFilter,
            font: formData.cssFont
        },
        fission: formData.fission,
        humanizeCursor: formData.humanizeCursor,
        proxy: {
            enable: formData.proxyEnable,
            type: formData.proxyType,
            host: formData.proxyHost,
            port: formData.proxyPort,
            auth: formData.proxyAuth,
            username: formData.proxyUser,
            password: formData.proxyPasswd
        }
    };
    await settingsStore.saveBrowserConfig(config);
};
</script>

<template>
    <a-layout style="background: transparent;">
        <a-card title="Настройки браузера" :bordered="false" style="width: 100%;">
            <a-row :gutter="[16, 16]">
                <!-- Путь к браузеру -->
                <a-col :xs="24" :md="24">
                    <div style="margin-bottom: 8px;">
                        <div style="font-weight: 600; margin-bottom: 4px;">Путь к браузеру</div>
                        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px;">
                            Пусто = путь по умолчанию Camoufox<br>
                            Windows: C:\camoufox\camoufox.exe<br>
                            Linux: /opt/camoufox/camoufox
                        </div>
                        <a-input v-model:value="formData.path" placeholder="Пусто = путь по умолчанию" />
                    </div>
                </a-col>

                <!-- Headless-режим -->
                <a-col :xs="24" :md="12">
                    <div style="margin-bottom: 8px;">
                        <div style="font-weight: 600; margin-bottom: 4px;">Headless-режим</div>
                        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px;">
                            Браузер запускается без интерфейса<br>
                            Режим входа и Xvfb принудительно отключают headless
                        </div>
                        <a-switch v-model:checked="formData.headless" />
                        <span style="margin-left: 8px;">
                            {{ formData.headless ? 'Включён' : 'Отключён' }}
                        </span>
                    </div>
                </a-col>

                <!-- Изоляция сайтов (Fission) -->
                <a-col :xs="24" :md="12">
                    <div style="margin-bottom: 8px;">
                        <div style="font-weight: 600; margin-bottom: 4px;">Изоляция сайтов (fission.autostart)</div>
                        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px;">
                            Отключение снижает потребление RAM на слабых серверах<br>
                            В обычном Firefox включено по умолчанию<br>
                            <span style="color: #faad14;">⚠️ Антибот-системы могут обнаружить автоматизацию через задержки между процессами</span>
                        </div>
                        <a-switch v-model:checked="formData.fission" />
                        <span style="margin-left: 8px;">
                            {{ formData.fission ? 'Включено' : 'Отключено (экономия памяти)' }}
                        </span>
                    </div>
                </a-col>

                <!-- Движение мыши -->
                <a-col :xs="24" :md="24">
                    <div style="margin-bottom: 8px;">
                        <div style="font-weight: 600; margin-bottom: 4px;">Режим движения мыши</div>
                        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px;">
                            Влияет на производительность и риск обнаружения ботом
                        </div>
                        <a-segmented v-model:value="formData.humanizeCursor" block :options="[
                            { label: 'Отключён (максимум производительности)', value: false },
                            { label: 'Ghost-Cursor (реалистичнее)', value: true },
                            { label: 'Встроенный Camoufox (баланс)', value: 'camou' }
                        ]" />
                        <div style="font-size: 11px; color: #8c8c8c; margin-top: 6px;">
                            <span v-if="formData.humanizeCursor === false">Нативные клики Playwright — максимальная производительность, но риск обнаружения</span>
                            <span v-else-if="formData.humanizeCursor === true">Оптимизированный ghost-cursor — имитирует траекторию мыши, чуть медленнее</span>
                            <span v-else>Встроенная функция humanize Camoufox — баланс производительности и реализма</span>
                        </div>
                    </div>
                </a-col>
            </a-row>

            <!-- Глобальный прокси (сворачиваемый) -->
            <div style="margin-top: 16px;">
                <a-collapse>
                    <a-collapse-panel key="proxy" header="Глобальный прокси">
                        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 16px;">
                            Используется для экземпляров без собственной настройки прокси
                        </div>

                        <!-- Включить прокси -->
                        <div style="margin-bottom: 16px;">
                            <a-switch v-model:checked="formData.proxyEnable" />
                            <span style="margin-left: 8px;">
                                {{ formData.proxyEnable ? 'Глобальный прокси включён' : 'Глобальный прокси отключён' }}
                            </span>
                        </div>

                        <!-- Тип прокси -->
                        <div style="margin-bottom: 16px;" v-if="formData.proxyEnable">
                            <div style="font-weight: 600; margin-bottom: 8px;">Тип прокси</div>
                            <a-segmented v-model:value="formData.proxyType" block :options="[
                                { label: 'HTTP', value: 'http' },
                                { label: 'SOCKS5', value: 'socks5' }
                            ]" />
                        </div>

                        <a-row :gutter="16" v-if="formData.proxyEnable">
                            <!-- Хост прокси -->
                            <a-col :xs="24" :md="12">
                                <div style="margin-bottom: 16px;">
                                    <div style="font-weight: 600; margin-bottom: 8px;">Хост прокси</div>
                                    <a-input v-model:value="formData.proxyHost" placeholder="Например: 127.0.0.1" />
                                </div>
                            </a-col>

                            <!-- Порт прокси -->
                            <a-col :xs="24" :md="12">
                                <div style="margin-bottom: 16px;">
                                    <div style="font-weight: 600; margin-bottom: 8px;">Порт прокси</div>
                                    <a-input-number v-model:value="formData.proxyPort" :min="1" :max="65535"
                                        style="width: 100%" placeholder="Например: 7890" />
                                </div>
                            </a-col>
                        </a-row>

                        <!-- Аутентификация -->
                        <div style="margin-bottom: 16px;" v-if="formData.proxyEnable">
                            <div style="font-weight: 600; margin-bottom: 8px;">Аутентификация прокси</div>
                            <a-switch v-model:checked="formData.proxyAuth" />
                            <span style="margin-left: 8px;">
                                {{ formData.proxyAuth ? 'Требуется' : 'Не требуется' }}
                            </span>
                        </div>

                        <a-row :gutter="16" v-if="formData.proxyEnable && formData.proxyAuth">
                            <!-- Имя пользователя -->
                            <a-col :xs="24" :md="12">
                                <div style="margin-bottom: 16px;">
                                    <div style="font-weight: 600; margin-bottom: 8px;">Имя пользователя</div>
                                    <a-input v-model:value="formData.proxyUser" placeholder="Введите имя пользователя" />
                                </div>
                            </a-col>

                            <!-- Пароль -->
                            <a-col :xs="24" :md="12">
                                <div style="margin-bottom: 16px;">
                                    <div style="font-weight: 600; margin-bottom: 8px;">Пароль</div>
                                    <a-input-password v-model:value="formData.proxyPasswd" placeholder="Введите пароль" />
                                </div>
                            </a-col>
                        </a-row>
                    </a-collapse-panel>

                    <!-- CSS-оптимизация -->
                    <a-collapse-panel key="cssInject" header="CSS-оптимизация">
                        <a-alert message="⚡ Для серверов без GPU: снижает нагрузку CPU отключением эффектов" type="info" show-icon
                            style="margin-bottom: 16px;" />

                        <!-- Отключить анимации -->
                        <div style="margin-bottom: 16px; padding: 12px; background: #fafafa; border-radius: 6px;">
                            <div style="display: flex; align-items: center; justify-content: space-between;">
                                <div>
                                    <div style="font-weight: 600; margin-bottom: 4px;">Отключить анимации</div>
                                    <div style="font-size: 12px; color: #8c8c8c;">
                                        Убирает CSS-переходы и анимации, заметно снижает нагрузку CPU
                                    </div>
                                    <a-tag color="green" style="margin-top: 6px;">Риск: низкий</a-tag>
                                    <span style="font-size: 11px; color: #389e0d; margin-left: 8px;">
                                        Почти не влияет на отпечаток, но возможны сбои в вёрстке
                                    </span>
                                </div>
                                <a-switch v-model:checked="formData.cssAnimation" />
                            </div>
                        </div>

                        <!-- Отключить фильтры -->
                        <div style="margin-bottom: 16px; padding: 12px; background: #fafafa; border-radius: 6px;">
                            <div style="display: flex; align-items: center; justify-content: space-between;">
                                <div>
                                    <div style="font-weight: 600; margin-bottom: 4px;">Отключить фильтры и тени</div>
                                    <div style="font-size: 12px; color: #8c8c8c;">
                                        Убирает blur, box-shadow и другие сложные эффекты
                                    </div>
                                    <a-tag color="orange" style="margin-top: 6px;">Риск: средний</a-tag>
                                    <span style="font-size: 11px; color: #faad14; margin-left: 8px;">
                                        Интерфейс ухудшится, редкие антиботы могут проверять CSS
                                    </span>
                                </div>
                                <a-switch v-model:checked="formData.cssFilter" />
                            </div>
                        </div>

                        <!-- Снизить качество шрифтов -->
                        <div style="padding: 12px; background: #fff2f0; border-radius: 6px; border: 1px solid #ffccc7;">
                            <div style="display: flex; align-items: center; justify-content: space-between;">
                                <div>
                                    <div style="font-weight: 600; margin-bottom: 4px;">Снизить качество шрифтов</div>
                                    <div style="font-size: 12px; color: #8c8c8c;">
                                        Принудительный быстрый режим рендеринга, минимальный выигрыш CPU
                                    </div>
                                    <a-tag color="red" style="margin-top: 6px;">⚠️ Риск: высокий</a-tag>
                                    <div style="font-size: 11px; color: #cf1322; margin-top: 4px;">
                                        Зазубренные края текста; отпечаток шрифтов отличается от обычного браузера — легко обнаружить
                                    </div>
                                </div>
                                <a-switch v-model:checked="formData.cssFont" />
                            </div>
                        </div>
                    </a-collapse-panel>
                </a-collapse>
            </div>

            <!-- Кнопка сохранения -->
            <div style="display: flex; justify-content: flex-end; margin-top: 24px;">
                <a-button type="primary" @click="handleSave">
                    Сохранить
                </a-button>
            </div>
        </a-card>
    </a-layout>
</template>
