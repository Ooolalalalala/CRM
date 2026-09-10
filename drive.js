const GOOGLE_CLIENT_ID =
  "767718571294-8ab171af0ks2j8ucu0ihev0muka2qc6d.apps.googleusercontent.com";

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const CRM_ROOT_FOLDER_NAME = "PersonalCRM";
const CRM_DATA_FOLDER_NAME = "data";
const CRM_PHOTOS_FOLDER_NAME = "photos";
const CONTACTS_FILE_NAME = "contacts.json";

let googleTokenClient = null;
let googleAccessToken = null;

let driveIds = {
  rootFolderId: null,
  dataFolderId: null,
  photosFolderId: null,
  contactsFileId: null
};


/* =========================================================
   ИНИЦИАЛИЗАЦИЯ GOOGLE LOGIN
   ========================================================= */

function initializeGoogleAuth() {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    const waitForGoogle = () => {
      attempts++;

      if (
        window.google &&
        google.accounts &&
        google.accounts.oauth2
      ) {
        googleTokenClient = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: GOOGLE_SCOPE,

          callback: async (response) => {
            if (response.error) {
              console.error("Google OAuth error:", response);
              reject(response);
              return;
            }

            googleAccessToken = response.access_token;

            try {
              await initializeDriveStorage();
              resolve();
            } catch (error) {
              reject(error);
            }
          }
        });

        return;
      }

      if (attempts > 50) {
        reject(new Error("Google Identity Services не загрузился."));
        return;
      }

      setTimeout(waitForGoogle, 100);
    };

    waitForGoogle();
  });
}


/* =========================================================
   ВХОД
   ========================================================= */

function loginWithGoogle() {
  return new Promise((resolve, reject) => {
    if (!googleTokenClient) {
      reject(new Error("Google Login ещё не инициализирован."));
      return;
    }

    googleTokenClient.callback = async (response) => {
      if (response.error) {
        reject(response);
        return;
      }

      googleAccessToken = response.access_token;

      try {
        await initializeDriveStorage();
        resolve();
      } catch (error) {
        reject(error);
      }
    };

    googleTokenClient.requestAccessToken({
      prompt: googleAccessToken ? "" : "consent"
    });
  });
}


/* =========================================================
   ВЫХОД
   ========================================================= */

function logoutGoogle() {
  if (!googleAccessToken) {
    return;
  }

  google.accounts.oauth2.revoke(
    googleAccessToken,
    () => {
      googleAccessToken = null;

      driveIds = {
        rootFolderId: null,
        dataFolderId: null,
        photosFolderId: null,
        contactsFileId: null
      };
    }
  );
}


/* =========================================================
   GOOGLE DRIVE API REQUEST
   ========================================================= */

async function driveRequest(url, options = {}) {
  if (!googleAccessToken) {
    throw new Error("Нет авторизации Google.");
  }

  const headers = new Headers(options.headers || {});

  headers.set(
    "Authorization",
    `Bearer ${googleAccessToken}`
  );

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (response.status === 401) {
    googleAccessToken = null;
    throw new Error("Сессия Google истекла. Войдите снова.");
  }

  if (!response.ok) {
    const errorText = await response.text();

    console.error(
      "Google Drive API error:",
      response.status,
      errorText
    );

    throw new Error(
      `Ошибка Google Drive: ${response.status}`
    );
  }

  return response;
}


/* =========================================================
   СОЗДАНИЕ СТРУКТУРЫ DRIVE
   ========================================================= */

async function initializeDriveStorage() {
  /*
    С drive.file приложение видит файлы,
    которые создало само.

    Поэтому ID созданных объектов сохраняются
    локально в браузере.
  */

  loadDriveIds();

  if (
    driveIds.rootFolderId &&
    driveIds.dataFolderId &&
    driveIds.photosFolderId &&
    driveIds.contactsFileId
  ) {
    try {
      await verifyDriveFile(driveIds.contactsFileId);
      return;
    } catch (error) {
      console.warn(
        "Сохранённая структура Drive больше недоступна. Создаём заново."
      );

      clearDriveIds();
    }
  }

  const rootFolder = await createFolder(
    CRM_ROOT_FOLDER_NAME,
    null
  );

  driveIds.rootFolderId = rootFolder.id;

  const dataFolder = await createFolder(
    CRM_DATA_FOLDER_NAME,
    driveIds.rootFolderId
  );

  driveIds.dataFolderId = dataFolder.id;

  const photosFolder = await createFolder(
    CRM_PHOTOS_FOLDER_NAME,
    driveIds.rootFolderId
  );

  driveIds.photosFolderId = photosFolder.id;

  const contactsFile = await createJsonFile(
    CONTACTS_FILE_NAME,
    createEmptyDatabase(),
    driveIds.dataFolderId
  );

  driveIds.contactsFileId = contactsFile.id;

  saveDriveIds();
}


/* =========================================================
   ПРОВЕРКА ФАЙЛА
   ========================================================= */

async function verifyDriveFile(fileId) {
  const response = await driveRequest(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,trashed`
  );

  const file = await response.json();

  if (file.trashed) {
    throw new Error("Файл находится в корзине.");
  }

  return file;
}


/* =========================================================
   СОЗДАНИЕ ПАПКИ
   ========================================================= */

async function createFolder(name, parentId = null) {
  const metadata = {
    name: name,
    mimeType: "application/vnd.google-apps.folder"
  };

  if (parentId) {
    metadata.parents = [parentId];
  }

  const response = await driveRequest(
    "https://www.googleapis.com/drive/v3/files?fields=id,name",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(metadata)
    }
  );

  return response.json();
}


/* =========================================================
   СОЗДАНИЕ JSON
   ========================================================= */

async function createJsonFile(
  filename,
  data,
  parentId
) {
  const metadata = {
    name: filename,
    mimeType: "application/json",
    parents: [parentId]
  };

  const boundary =
    "crm_boundary_" +
    Math.random().toString(36).slice(2);

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(data, null, 2) +
    `\r\n--${boundary}--`;

  const response = await driveRequest(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name",
    {
      method: "POST",
      headers: {
        "Content-Type":
          `multipart/related; boundary=${boundary}`
      },
      body
    }
  );

  return response.json();
}


/* =========================================================
   ПУСТАЯ БАЗА
   ========================================================= */

function createEmptyDatabase() {
  return {
    version: 1,

    createdAt: new Date().toISOString(),

    updatedAt: new Date().toISOString(),

    settings: {
      familyRootId: null
    },

    contacts: [],

    trash: []
  };
}


/* =========================================================
   ЗАГРУЗКА БАЗЫ
   ========================================================= */

async function loadDatabase() {
  if (!driveIds.contactsFileId) {
    throw new Error("Файл contacts.json не найден.");
  }

  const response = await driveRequest(
    `https://www.googleapis.com/drive/v3/files/${driveIds.contactsFileId}?alt=media`
  );

  const text = await response.text();

  if (!text.trim()) {
    return createEmptyDatabase();
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    console.error(error);

    throw new Error(
      "contacts.json повреждён или содержит некорректные данные."
    );
  }
}


/* =========================================================
   СОХРАНЕНИЕ БАЗЫ
   ========================================================= */

async function saveDatabase(database) {
  if (!driveIds.contactsFileId) {
    throw new Error("Файл contacts.json не найден.");
  }

  database.updatedAt = new Date().toISOString();

  const response = await driveRequest(
    `https://www.googleapis.com/upload/drive/v3/files/${driveIds.contactsFileId}?uploadType=media`,
    {
      method: "PATCH",
      headers: {
        "Content-Type":
          "application/json; charset=UTF-8"
      },
      body: JSON.stringify(database, null, 2)
    }
  );

  return response.json();
}


/* =========================================================
   ПАПКА ФОТОГРАФИЙ КОНТАКТА
   ========================================================= */

async function createContactPhotoFolder(contactId) {
  if (!driveIds.photosFolderId) {
    throw new Error("Папка photos не найдена.");
  }

  const folder = await createFolder(
    contactId,
    driveIds.photosFolderId
  );

  return folder.id;
}


/* =========================================================
   ЗАГРУЗКА ФОТО
   ========================================================= */

async function uploadPhoto(
  file,
  contactPhotoFolderId
) {
  if (!file) {
    throw new Error("Файл фотографии не выбран.");
  }

  const metadata = {
    name: file.name,
    parents: [contactPhotoFolderId]
  };

  const boundary =
    "crm_photo_boundary_" +
    Math.random().toString(36).slice(2);

  const metadataBlob = new Blob(
    [JSON.stringify(metadata)],
    {
      type: "application/json"
    }
  );

  const body = new FormData();

  /*
    Для multipart upload Google Drive API
    удобнее сформировать multipart/related вручную,
    поэтому ниже собираем Blob.
  */

  const multipartBody = new Blob(
    [
      `--${boundary}\r\n`,
      `Content-Type: application/json; charset=UTF-8\r\n\r\n`,
      metadataBlob,
      `\r\n--${boundary}\r\n`,
      `Content-Type: ${file.type || "application/octet-stream"}\r\n\r\n`,
      file,
      `\r\n--${boundary}--`
    ]
  );

  const response = await driveRequest(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size",
    {
      method: "POST",
      headers: {
        "Content-Type":
          `multipart/related; boundary=${boundary}`
      },
      body: multipartBody
    }
  );

  return response.json();
}


/* =========================================================
   ПОЛУЧЕНИЕ ФОТО
   ========================================================= */

async function getPhotoBlob(fileId) {
  const response = await driveRequest(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
  );

  return response.blob();
}


/* =========================================================
   URL ФОТО ДЛЯ <img>
   ========================================================= */

async function getPhotoObjectUrl(fileId) {
  const blob = await getPhotoBlob(fileId);

  return URL.createObjectURL(blob);
}


/* =========================================================
   УДАЛЕНИЕ ФОТО
   ========================================================= */

async function deleteDriveFile(fileId) {
  await driveRequest(
    `https://www.googleapis.com/drive/v3/files/${fileId}`,
    {
      method: "DELETE"
    }
  );
}


/* =========================================================
   ПЕРЕМЕЩЕНИЕ DRIVE-ФАЙЛА В КОРЗИНУ
   ========================================================= */

async function trashDriveFile(fileId) {
  const response = await driveRequest(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,trashed`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        trashed: true
      })
    }
  );

  return response.json();
}


/* =========================================================
   ЛОКАЛЬНОЕ ХРАНЕНИЕ ID
   ========================================================= */

function saveDriveIds() {
  localStorage.setItem(
    "personalCRM_driveIds",
    JSON.stringify(driveIds)
  );
}


function loadDriveIds() {
  try {
    const saved =
      localStorage.getItem("personalCRM_driveIds");

    if (!saved) {
      return;
    }

    const parsed = JSON.parse(saved);

    driveIds = {
      ...driveIds,
      ...parsed
    };
  } catch (error) {
    console.warn(
      "Не удалось прочитать сохранённые Drive ID."
    );
  }
}


function clearDriveIds() {
  localStorage.removeItem(
    "personalCRM_driveIds"
  );

  driveIds = {
    rootFolderId: null,
    dataFolderId: null,
    photosFolderId: null,
    contactsFileId: null
  };
}


/* =========================================================
   СОСТОЯНИЕ
   ========================================================= */

function isGoogleAuthenticated() {
  return Boolean(googleAccessToken);
}


function getDriveIds() {
  return {
    ...driveIds
  };
}


/* =========================================================
   API ДЛЯ app.js
   ========================================================= */

window.DriveAPI = {
  initializeGoogleAuth,
  loginWithGoogle,
  logoutGoogle,

  loadDatabase,
  saveDatabase,

  createContactPhotoFolder,
  uploadPhoto,
  getPhotoBlob,
  getPhotoObjectUrl,
  deleteDriveFile,
  trashDriveFile,

  isGoogleAuthenticated,
  getDriveIds
};
