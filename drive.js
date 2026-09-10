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
   GOOGLE AUTH
   ========================================================= */

function initializeGoogleAuth() {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    const wait = () => {
      attempts++;

      if (
        window.google &&
        google.accounts &&
        google.accounts.oauth2
      ) {
        googleTokenClient =
          google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: GOOGLE_SCOPE,
            callback: () => {}
          });

        resolve();
        return;
      }

      if (attempts >= 100) {
        reject(
          new Error("Google Identity Services не загрузился.")
        );
        return;
      }

      setTimeout(wait, 100);
    };

    wait();
  });
}


function loginWithGoogle() {
  return new Promise((resolve, reject) => {

    if (!googleTokenClient) {
      reject(
        new Error("Google Login не инициализирован.")
      );
      return;
    }

    googleTokenClient.callback =
      async (response) => {

        if (response.error) {
          reject(response);
          return;
        }

        googleAccessToken =
          response.access_token;

        try {
          await initializeDriveStorage();
          resolve();
        } catch (error) {
          reject(error);
        }
      };

    googleTokenClient.requestAccessToken({
      prompt: ""
    });
  });
}


function logoutGoogle() {
  if (!googleAccessToken) return;

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
   DRIVE REQUEST
   ========================================================= */

async function driveRequest(
  url,
  options = {}
) {
  if (!googleAccessToken) {
    throw new Error(
      "Нет авторизации Google."
    );
  }

  const headers =
    new Headers(options.headers || {});

  headers.set(
    "Authorization",
    `Bearer ${googleAccessToken}`
  );

  const response = await fetch(
    url,
    {
      ...options,
      headers
    }
  );

  if (response.status === 401) {
    googleAccessToken = null;

    throw new Error(
      "Сессия Google истекла. Войдите снова."
    );
  }

  if (!response.ok) {
    const text =
      await response.text();

    console.error(
      "Google Drive API:",
      response.status,
      text
    );

    throw new Error(
      `Ошибка Google Drive: ${response.status}`
    );
  }

  return response;
}


/* =========================================================
   ПОИСК ФАЙЛА / ПАПКИ
   ========================================================= */

async function findDriveItem(
  name,
  parentId = null,
  mimeType = null
) {
  let query =
    `name='${escapeDriveQuery(name)}' and trashed=false`;

  if (parentId) {
    query +=
      ` and '${parentId}' in parents`;
  }

  if (mimeType) {
    query +=
      ` and mimeType='${mimeType}'`;
  }

  const url =
    "https://www.googleapis.com/drive/v3/files" +
    "?spaces=drive" +
    "&fields=files(id,name,mimeType,parents)" +
    "&pageSize=20" +
    "&q=" +
    encodeURIComponent(query);

  const response =
    await driveRequest(url);

  const data =
    await response.json();

  if (!data.files?.length) {
    return null;
  }

  return data.files[0];
}


function escapeDriveQuery(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}


/* =========================================================
   СОЗДАНИЕ / ПОИСК СТРУКТУРЫ
   ========================================================= */

async function initializeDriveStorage() {

  let root =
    await findDriveItem(
      CRM_ROOT_FOLDER_NAME,
      null,
      "application/vnd.google-apps.folder"
    );

  if (!root) {
    root =
      await createFolder(
        CRM_ROOT_FOLDER_NAME
      );
  }

  driveIds.rootFolderId =
    root.id;


  let dataFolder =
    await findDriveItem(
      CRM_DATA_FOLDER_NAME,
      root.id,
      "application/vnd.google-apps.folder"
    );

  if (!dataFolder) {
    dataFolder =
      await createFolder(
        CRM_DATA_FOLDER_NAME,
        root.id
      );
  }

  driveIds.dataFolderId =
    dataFolder.id;


  let photosFolder =
    await findDriveItem(
      CRM_PHOTOS_FOLDER_NAME,
      root.id,
      "application/vnd.google-apps.folder"
    );

  if (!photosFolder) {
    photosFolder =
      await createFolder(
        CRM_PHOTOS_FOLDER_NAME,
        root.id
      );
  }

  driveIds.photosFolderId =
    photosFolder.id;


  let contactsFile =
    await findDriveItem(
      CONTACTS_FILE_NAME,
      dataFolder.id,
      "application/json"
    );

  if (!contactsFile) {
    contactsFile =
      await createJsonFile(
        CONTACTS_FILE_NAME,
        createEmptyDatabase(),
        dataFolder.id
      );
  }

  driveIds.contactsFileId =
    contactsFile.id;
}


/* =========================================================
   CREATE FOLDER
   ========================================================= */

async function createFolder(
  name,
  parentId = null
) {
  const metadata = {
    name,
    mimeType:
      "application/vnd.google-apps.folder"
  };

  if (parentId) {
    metadata.parents =
      [parentId];
  }

  const response =
    await driveRequest(
      "https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body:
          JSON.stringify(metadata)
      }
    );

  return response.json();
}


/* =========================================================
   EMPTY DATABASE
   ========================================================= */

function createEmptyDatabase() {
  return {
    version: 1,

    createdAt:
      new Date().toISOString(),

    updatedAt:
      new Date().toISOString(),

    settings: {
      familyRootId: null
    },

    contacts: [],

    trash: []
  };
}


/* =========================================================
   CREATE JSON
   ========================================================= */

async function createJsonFile(
  filename,
  data,
  parentId
) {
  const metadata = {
    name: filename,
    mimeType:
      "application/json",
    parents:
      [parentId]
  };

  const boundary =
    "crm_" +
    crypto.randomUUID();

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(data, null, 2) +
    `\r\n--${boundary}--`;

  const response =
    await driveRequest(
      "https://www.googleapis.com/upload/drive/v3/files" +
      "?uploadType=multipart" +
      "&fields=id,name,mimeType",
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
   LOAD DATABASE
   ========================================================= */

async function loadDatabase() {
  if (!driveIds.contactsFileId) {
    throw new Error(
      "contacts.json не найден."
    );
  }

  const response =
    await driveRequest(
      `https://www.googleapis.com/drive/v3/files/${driveIds.contactsFileId}?alt=media`
    );

  const text =
    await response.text();

  if (!text.trim()) {
    return createEmptyDatabase();
  }

  try {
    const database =
      JSON.parse(text);

    database.contacts ||=
      [];

    database.trash ||=
      [];

    database.settings ||=
      {
        familyRootId: null
      };

    return database;

  } catch {
    throw new Error(
      "Файл contacts.json повреждён."
    );
  }
}


/* =========================================================
   SAVE DATABASE
   ========================================================= */

async function saveDatabase(
  database
) {
  database.updatedAt =
    new Date().toISOString();

  const response =
    await driveRequest(
      "https://www.googleapis.com/upload/drive/v3/files/" +
      driveIds.contactsFileId +
      "?uploadType=media",
      {
        method: "PATCH",

        headers: {
          "Content-Type":
            "application/json; charset=UTF-8"
        },

        body:
          JSON.stringify(
            database,
            null,
            2
          )
      }
    );

  return response.json();
}


/* =========================================================
   CONTACT PHOTO FOLDER
   ========================================================= */

async function getOrCreateContactPhotoFolder(
  contactId
) {
  let folder =
    await findDriveItem(
      contactId,
      driveIds.photosFolderId,
      "application/vnd.google-apps.folder"
    );

  if (!folder) {
    folder =
      await createFolder(
        contactId,
        driveIds.photosFolderId
      );
  }

  return folder.id;
}


/* =========================================================
   UPLOAD PHOTO
   ========================================================= */

async function uploadPhoto(
  file,
  contactPhotoFolderId
) {
  const metadata = {
    name: file.name,

    parents:
      [contactPhotoFolderId]
  };

  const boundary =
    "crm_photo_" +
    crypto.randomUUID();

  const multipartBody =
    new Blob(
      [
        `--${boundary}\r\n`,
        "Content-Type: application/json; charset=UTF-8\r\n\r\n",
        JSON.stringify(metadata),

        `\r\n--${boundary}\r\n`,
        `Content-Type: ${file.type || "application/octet-stream"}\r\n\r\n`,

        file,

        `\r\n--${boundary}--`
      ]
    );

  const response =
    await driveRequest(
      "https://www.googleapis.com/upload/drive/v3/files" +
      "?uploadType=multipart" +
      "&fields=id,name,mimeType,size,createdTime",
      {
        method: "POST",

        headers: {
          "Content-Type":
            `multipart/related; boundary=${boundary}`
        },

        body:
          multipartBody
      }
    );

  return response.json();
}


/* =========================================================
   PHOTO
   ========================================================= */

async function getPhotoBlob(
  fileId
) {
  const response =
    await driveRequest(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
    );

  return response.blob();
}


async function getPhotoObjectUrl(
  fileId
) {
  const blob =
    await getPhotoBlob(fileId);

  return URL.createObjectURL(blob);
}


/* =========================================================
   DELETE / TRASH DRIVE FILE
   ========================================================= */

async function deleteDriveFile(
  fileId
) {
  await driveRequest(
    `https://www.googleapis.com/drive/v3/files/${fileId}`,
    {
      method: "DELETE"
    }
  );
}


async function trashDriveFile(
  fileId
) {
  const response =
    await driveRequest(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,trashed`,
      {
        method: "PATCH",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            trashed: true
          })
      }
    );

  return response.json();
}


/* =========================================================
   STATUS
   ========================================================= */

function isGoogleAuthenticated() {
  return Boolean(
    googleAccessToken
  );
}


function getDriveIds() {
  return {
    ...driveIds
  };
}


/* =========================================================
   PUBLIC API
   ========================================================= */

window.DriveAPI = {

  initializeGoogleAuth,
  loginWithGoogle,
  logoutGoogle,

  loadDatabase,
  saveDatabase,

  getOrCreateContactPhotoFolder,

  uploadPhoto,
  getPhotoBlob,
  getPhotoObjectUrl,

  deleteDriveFile,
  trashDriveFile,

  isGoogleAuthenticated,
  getDriveIds
};
