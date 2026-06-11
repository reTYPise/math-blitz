# agents.md — math-blitz

Контекст для AI-агента при пустой истории чата.

## Проект

Статический веб-тренажёр **устного счёта** (умножение, деление, сложение, вычитание). Репозиторий: `reTYPise/math-blitz`.

- **Live:** https://retypise.github.io/math-blitz/
- **Локально:** `npx serve -l 3000` → http://localhost:3000

## Структура

```
index.html          # дашборд + game + score (экраны .screen)
css/styles.css      # mobile-first, max-width 1240px (--dash-max)
js/app.js           # логика игры, генераторы вопросов, дашборд
js/db.js            # SQLite через sql.js → localStorage
js/vendor/          # sql-wasm.js + sql-wasm.wasm
.github/workflows/pages.yml
.nojekyll
agents.md
```

## База данных

- Ключ localStorage: `math-blitz-sqlite-v1`
- Таблица `sessions`: date, trainer, game_mode, correct, wrong, answered, best_streak, elapsed_sec, range_max, input_mode
- `trainer`: строка операций, например `×`, `×+÷`, `×+÷+−`
- Миграция из старых JSON-ключей (`math-blitz-stats-v1`, `math-blitz-v1`) в `db.js`

## Экраны

1. `#screen-menu` — дашборд (сегодня, KPI, breakdown по операциям, сессии, настройки + СТАРТ)
2. `#screen-game` — игра (sticky header, quit, справочник ответов справа/снизу)
3. `#screen-score` — итог сессии с датой и серией дней

## Особенности math-blitz

- Несколько операций одновременно (op-btn toggle)
- Диапазон чисел 1–10 … 1–100, фокус на конкретное число
- Порядок вопросов: random / ordered-first / ordered
- Режимы: classic, timed, survival
- Ввод: keyboard / choices / screen
- Справочник готовых ответов (`practice-guide`) с подсветкой текущей строки
- `#quick-start-btn` — случайные разумные настройки и старт

## Деплой

GitHub Pages из `main`, корень репо. В `<head>` — скрипт `APP_BASE_PATH` для подкаталога Pages.

## QA-процесс (по запросу пользователя)

Запускать **двух субагентов параллельно**:
1. **Визуал** — скриншоты 1280/768/375/320, шрифты, контраст, overflow
2. **Кнопки** — все контролы, особенно `#quit-btn` на mobile без скролла

Отчёты → правки → повторный прогон тех же двух.

## Не коммитить

`mcps/`, `terminals/`, `qa-screenshots/`, `*.png` — в `.gitignore`.

## Связанный проект

`C:\personal\development\daily-blitz-seasons` — тот же стек UI/дашборда, но тренажёр кварталов и сезонов.