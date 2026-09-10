# PersonalCRM

PersonalCRM — это простая личная CRM/PWA для хранения контактов, семейных связей, фотографий и заметок.

Приложение работает прямо в браузере и может быть установлено как PWA на компьютер, телефон или планшет.

Главная особенность: данные не хранятся на GitHub или на отдельном сервере. Они сохраняются непосредственно в Google Drive пользователя.

## Возможности

- хранение контактов;
- имя, фамилия, отчество;
- дата рождения и дата смерти;
- место рождения и смерти;
- категория;
- несколько тегов;
- телефоны, E-Mail и адреса;
- хранение старых контактных данных с указанием даты или периода;
- автоматическая сортировка датированных записей;
- заметки с датой;
- отдельное поле комментария;
- увлечения;
- размеры одежды и обуви;
- работа, фирма, образование;
- произвольные дополнительные поля;
- связи между людьми;
- отец, мать, сын, дочь, брат, сестра, супруг/супруга;
- несколько фотографий для каждого контакта;
- отдельное фото профиля;
- семейное дерево;
- поиск и фильтрация;
- корзина для удалённых контактов;
- экспорт контакта в стандартный формат `.vcf`;
- работа с ПК, телефона и планшета.

## Где хранятся данные

После первого входа PersonalCRM создаёт в Google Drive пользователя следующую структуру:

    PersonalCRM/
    ├── data/
    │   └── contacts.json
    └── photos/
        ├── <contact-id>/
        │   ├── photo1.jpg
        │   └── photo2.jpg
        └── ...

В файле `contacts.json` хранятся данные контактов, связи, заметки и ссылки на фотографии.

Оригинальные фотографии хранятся отдельно в папке `PersonalCRM/photos/`.

GitHub Pages хранит только HTML, CSS и JavaScript приложения.

Персональные данные пользователей в репозитории GitHub не сохраняются.

## Google OAuth и Client ID

Для доступа к Google Drive приложение использует Google OAuth 2.0.

Client ID находится в файле:

`drive.js`

В начале файла находится строка:

    const GOOGLE_CLIENT_ID =
      "YOUR_CLIENT_ID.apps.googleusercontent.com";

Если вы создаёте собственную копию PersonalCRM, замените это значение на свой Google OAuth Client ID.

Пример:

    const GOOGLE_CLIENT_ID =
      "1234567890-xxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com";

Client ID не является паролем или секретным ключом и может находиться в клиентском JavaScript.

Client Secret в этом проекте не используется и не должен добавляться в репозиторий.

## Как создать собственный Google OAuth Client

### 1. Создайте проект Google Cloud

Откройте:

https://console.cloud.google.com/

Создайте новый проект, например:

`PersonalCRM`

### 2. Включите Google Drive API

В Google Cloud Console откройте:

`APIs & Services → Library → Google Drive API → Enable`

### 3. Настройте Google Auth Platform

Откройте:

`Google Auth Platform → Get started`

Укажите:

`App name: PersonalCRM`

В качестве Audience выберите:

`External`

Укажите свой E-Mail как контактный адрес.

Если приложение используется только вами или небольшой группой людей, его можно оставить в режиме:

`Testing`

### 4. Добавьте Test users

Откройте:

`Google Auth Platform → Audience → Test users`

Добавьте Google-аккаунты людей, которым разрешён вход в приложение.

Каждый пользователь будет работать со своей собственной папкой `PersonalCRM` в своём Google Drive.

### 5. Создайте OAuth Client

Откройте:

`Google Auth Platform → Clients → Create OAuth client`

Выберите:

`Application type: Web application`

Например:

`Name: PersonalCRM`

### 6. Укажите адрес GitHub Pages

Если приложение опубликовано по адресу:

`https://USERNAME.github.io/CRM/`

то в:

`Authorized JavaScript origins`

укажите:

`https://USERNAME.github.io`

А в:

`Authorized redirect URIs`

укажите:

`https://USERNAME.github.io/CRM/`

После этого создайте OAuth Client.

Google покажет Client ID.

Скопируйте его в файл `drive.js`.

## Публикация через GitHub Pages

Создайте репозиторий GitHub и загрузите в него файлы проекта.

Структура проекта:

    CRM/
    ├── index.html
    ├── app.js
    ├── style.css
    ├── drive.js
    ├── manifest.json
    ├── service-worker.js
    └── icons/
        ├── icon-192.png
        └── icon-512.png

После этого откройте:

`Repository → Settings → Pages`

Выберите:

`Source: Deploy from a branch`

`Branch: main`

`Folder: / (root)`

После публикации приложение будет доступно по адресу:

`https://USERNAME.github.io/CRM/`

## Доступ к Google Drive

PersonalCRM использует scope:

`https://www.googleapis.com/auth/drive.file`

Это означает, что приложение работает только с файлами и папками, которые оно создаёт или к которым пользователь предоставил ему доступ.

Приложение не получает полный доступ ко всему Google Drive.

## Работа нескольких пользователей

Один и тот же опубликованный сайт может использоваться несколькими Google-аккаунтами.

Каждый пользователь получает собственную независимую базу в своём Google Drive.

Пример:

    Google Account A
    └── PersonalCRM/

    Google Account B
    └── PersonalCRM/

Данные разных пользователей не объединяются и не пересекаются.

## Резервное копирование

Основная база находится в:

`PersonalCRM/data/contacts.json`

Фотографии находятся в:

`PersonalCRM/photos/`

Поэтому даже если сайт или GitHub-репозиторий станет недоступен, данные остаются в Google Drive пользователя.

Для дополнительной защиты рекомендуется периодически скачивать всю папку `PersonalCRM` как резервную копию.

## Лицензия

При необходимости можно добавить MIT License или другую выбранную лицензию проекта.
