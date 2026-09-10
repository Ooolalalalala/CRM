/* =========================================================
   PersonalCRM
   Основная логика
   ========================================================= */

let database = null;
let currentContactId = null;
let editingContactId = null;
let formContactId = null;

let pendingProfilePhoto = null;
let removeProfilePhoto = false;
let localProfilePreviewUrl = null;

let photoUrls = new Map();

let viewerPhotos = [];
let viewerPhotoIndex = 0;


/* =========================================================
   BASIC
   ========================================================= */

function $(id) {
  return document.getElementById(id);
}

function uuid() {
  return crypto.randomUUID();
}

function safe(value) {
  return value == null ? "" : String(value);
}

function escapeHtml(value) {
  return safe(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fullName(contact) {
  return [
    contact.lastName,
    contact.firstName,
    contact.middleName
  ].filter(Boolean).join(" ");
}

function shortName(contact) {
  return [
    contact.firstName,
    contact.lastName
  ].filter(Boolean).join(" ");
}

function getContact(id) {
  return database?.contacts?.find(c => c.id === id);
}

function initials(contact) {
  return (
    safe(contact.firstName).charAt(0) +
    safe(contact.lastName).charAt(0)
  ).toUpperCase() || "?";
}


/* =========================================================
   ДАТА / ПЕРИОД
   ========================================================= */

/*
   Пустая дата считается самой актуальной.

   2019–2024 -> 2024
   с 2025    -> 2025
   ~2018     -> 2018
*/
function getDateSortValue(value) {
  const text = safe(value).trim();

  if (!text) {
    return Number.POSITIVE_INFINITY;
  }

  const years = [
    ...text.matchAll(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/g)
  ].map(match => Number(match[1]));

  if (!years.length) {
    return -Infinity;
  }

  return years[years.length - 1];
}


function sortDatedItems(items = []) {
  return items
    .map((item, index) => ({
      item,
      index
    }))
    .sort((a, b) => {
      const dateA =
        getDateSortValue(a.item.date);

      const dateB =
        getDateSortValue(b.item.date);

      if (dateA !== dateB) {
        return dateB - dateA;
      }

      return a.index - b.index;
    })
    .map(entry => entry.item);
}


/* =========================================================
   STANDARD TYPES
   ========================================================= */

function normalizeType(value) {
  return safe(value)
    .trim()
    .toLowerCase();
}


function standardType(value) {
  const type = normalizeType(value);

  if (
    type === "телефон" ||
    type === "phone" ||
    type === "telefon" ||
    type === "мобильный" ||
    type === "мобильный телефон"
  ) {
    return "phone";
  }

  if (
    type === "e-mail" ||
    type === "email" ||
    type === "электронная почта"
  ) {
    return "email";
  }

  if (
    type === "адрес" ||
    type === "address" ||
    type === "adresse"
  ) {
    return "address";
  }

  if (
    type === "работа / фирма" ||
    type === "работа" ||
    type === "фирма" ||
    type === "company" ||
    type === "firma"
  ) {
    return "company";
  }

  return null;
}


function getLatestStandardItem(items, kind) {
  return sortDatedItems(
    (items || []).filter(
      item => standardType(item.type) === kind
    )
  )[0] || null;
}


/* =========================================================
   ВОЗРАСТ
   ========================================================= */

function calculateAge(contact) {
  if (!contact.birthDate) {
    return "";
  }

  const birth = new Date(contact.birthDate);

  if (Number.isNaN(birth.getTime())) {
    return "";
  }

  const end = contact.deathDate
    ? new Date(contact.deathDate)
    : new Date();

  if (Number.isNaN(end.getTime())) {
    return "";
  }

  let age =
    end.getFullYear() -
    birth.getFullYear();

  const month =
    end.getMonth() -
    birth.getMonth();

  if (
    month < 0 ||
    (
      month === 0 &&
      end.getDate() < birth.getDate()
    )
  ) {
    age--;
  }

  return age >= 0 ? age : "";
}


function lifeText(contact) {
  const parts = [];

  if (contact.birthDate || contact.deathDate) {
    parts.push(
      `${contact.birthDate || "?"} — ${contact.deathDate || ""}`
    );
  }

  const age = calculateAge(contact);

  if (age !== "" && !contact.deathDate) {
    parts.push(`${age} лет`);
  }

  return parts.join(" · ");
}


/* =========================================================
   SYNC
   ========================================================= */

function showSync(text) {
  $("syncStatus").textContent = text;
  $("syncStatus").classList.remove("hidden");
}

function hideSync(delay = 600) {
  setTimeout(() => {
    $("syncStatus").classList.add("hidden");
  }, delay);
}

async function persistDatabase() {
  showSync("Сохранение...");

  try {
    await DriveAPI.saveDatabase(database);

    showSync("Сохранено");
    hideSync();
  } catch (error) {
    console.error(error);

    showSync("Ошибка сохранения");
    alert(error.message);
  }
}


/* =========================================================
   NAVIGATION
   ========================================================= */

function showPage(pageName) {
  document.querySelectorAll(".page")
    .forEach(page =>
      page.classList.remove("active")
    );

  const pages = {
    contacts: "contactsPage",
    contact: "contactPage",
    family: "familyPage",
    trash: "trashPage"
  };

  $(pages[pageName])
    ?.classList.add("active");

  document.querySelectorAll(
    ".nav-btn, .mobile-nav-btn"
  ).forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === pageName
    );
  });

  window.scrollTo(0, 0);
}


/* =========================================================
   CONTACT LIST
   ========================================================= */

function renderContacts() {
  const list = $("contactsList");

  list.innerHTML = "";

  const search =
    $("contactSearch")
      .value
      .trim()
      .toLowerCase();

  const category =
    $("categoryFilter").value;

  let contacts =
    [...database.contacts];

  contacts = contacts.filter(contact => {
    if (
      category &&
      contact.category !== category
    ) {
      return false;
    }

    if (!search) {
      return true;
    }

    const searchable = [
      contact.firstName,
      contact.lastName,
      contact.middleName,
      contact.category,
      ...(contact.tags || []),

      ...(contact.contactData || [])
        .flatMap(item => [
          item.type,
          item.value,
          item.date
        ]),

      ...(contact.personalData || [])
        .flatMap(item => [
          item.type,
          item.value,
          item.date
        ]),

      ...(contact.customFields || [])
        .flatMap(item => [
          item.type,
          item.value,
          item.date
        ])
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return searchable.includes(search);
  });

  contacts.sort((a, b) => {
    const lastname =
      safe(a.lastName).localeCompare(
        safe(b.lastName),
        "ru"
      );

    if (lastname !== 0) {
      return lastname;
    }

    return safe(a.firstName)
      .localeCompare(
        safe(b.firstName),
        "ru"
      );
  });

  $("contactsCount").textContent =
    `${contacts.length} контактов`;

  $("emptyContacts").classList.toggle(
    "hidden",
    contacts.length !== 0
  );

  contacts.forEach(contact => {
    const item =
      document.createElement("div");

    item.className =
      "contact-list-item";

    item.addEventListener(
      "click",
      () => openContact(contact.id)
    );


    /* Photo */

    const photoContainer =
      document.createElement("div");

    if (contact.profilePhotoId) {
      const img =
        document.createElement("img");

      img.className =
        "contact-list-photo";

      img.alt = "";

      loadPhotoIntoImage(
        img,
        contact.profilePhotoId
      );

      photoContainer.appendChild(img);

    } else {
      photoContainer.className =
        "contact-list-photo-placeholder";

      photoContainer.textContent =
        initials(contact);
    }


    /* Name */

    const main =
      document.createElement("div");

    main.className =
      "contact-list-main";

    const name =
      document.createElement("div");

    name.className =
      "contact-list-name";

    name.textContent =
      shortName(contact) || "Без имени";

    const meta =
      document.createElement("div");

    meta.className =
      "contact-list-meta";

    const age =
      calculateAge(contact);

    meta.textContent = [
      age !== "" ? `${age} лет` : "",
      contact.category || ""
    ]
      .filter(Boolean)
      .join(" · ");

    main.append(
      name,
      meta
    );


    /* Phone / Email */

    const details =
      document.createElement("div");

    details.className =
      "contact-list-details";

    const phone =
      getLatestStandardItem(
        contact.contactData,
        "phone"
      );

    const email =
      getLatestStandardItem(
        contact.contactData,
        "email"
      );

    if (phone?.value) {
      const row =
        document.createElement("div");

      row.className =
        "contact-list-detail";

      row.innerHTML = `
        <span class="contact-list-detail-label">Тел.</span>
        ${escapeHtml(phone.value)}
      `;

      details.appendChild(row);
    }

    if (email?.value) {
      const row =
        document.createElement("div");

      row.className =
        "contact-list-detail";

      row.innerHTML = `
        <span class="contact-list-detail-label">E-Mail</span>
        ${escapeHtml(email.value)}
      `;

      details.appendChild(row);
    }

    item.append(
      photoContainer,
      main,
      details
    );

    list.appendChild(item);
  });

  renderCategoryFilter();
}


function renderCategoryFilter() {
  const select =
    $("categoryFilter");

  const current =
    select.value;

  const categories = [
    ...new Set(
      database.contacts
        .map(contact => contact.category)
        .filter(Boolean)
    )
  ].sort(
    (a, b) =>
      a.localeCompare(b, "ru")
  );

  select.innerHTML =
    '<option value="">Все категории</option>';

  categories.forEach(category => {
    const option =
      document.createElement("option");

    option.value = category;
    option.textContent = category;

    select.appendChild(option);
  });

  select.value =
    categories.includes(current)
      ? current
      : "";
}


/* =========================================================
   CONTACT VIEW
   ========================================================= */

async function openContact(id) {
  const contact =
    getContact(id);

  if (!contact) {
    return;
  }

  currentContactId = id;

  showPage("contact");

  $("profileName").textContent =
    fullName(contact) || "Без имени";

  $("profileLife").textContent =
    lifeText(contact);

  $("profileCategory").textContent =
    contact.category || "";

  renderTags(contact);
  renderProfilePhoto(contact);

  renderBasicInfo(contact);
  renderContactInfo(contact);
  renderPersonalInfo(contact);
  renderCustomFields(contact);
  renderNotes(contact);
  renderComment(contact);
  renderRelations(contact);

  await renderPhotos(contact);
}


function renderTags(contact) {
  const container =
    $("profileTags");

  container.innerHTML = "";

  (contact.tags || [])
    .forEach(tag => {
      const el =
        document.createElement("span");

      el.className = "tag";
      el.textContent = tag;

      container.appendChild(el);
    });
}


function renderProfilePhoto(contact) {
  const img =
    $("profilePhoto");

  const placeholder =
    $("profilePhotoPlaceholder");

  if (!contact.profilePhotoId) {
    img.classList.add("hidden");

    placeholder.classList.remove(
      "hidden"
    );

    placeholder.textContent =
      initials(contact);

    return;
  }

  placeholder.classList.add("hidden");
  img.classList.remove("hidden");

  loadPhotoIntoImage(
    img,
    contact.profilePhotoId
  );
}


function genderLabel(value) {
  const labels = {
    male: "Мужской",
    female: "Женский",
    unknown: "Неизвестно"
  };

  return labels[value] || "";
}


function renderBasicInfo(contact) {
  renderSimpleRows(
    $("basicInfo"),
    [
      ["Имя", contact.firstName],
      ["Фамилия", contact.lastName],
      [
        "Отчество / другие имена",
        contact.middleName
      ],
      ["Пол", genderLabel(contact.gender)],
      ["Дата рождения", contact.birthDate],
      ["Дата смерти", contact.deathDate],
      ["Место рождения", contact.birthPlace],
      ["Место смерти", contact.deathPlace]
    ]
  );
}


function renderSimpleRows(
  container,
  rows
) {
  container.innerHTML = "";

  rows
    .filter(([, value]) =>
      value !== "" &&
      value != null
    )
    .forEach(([label, value]) => {
      const row =
        document.createElement("div");

      row.className = "data-row";

      row.innerHTML = `
        <div class="data-label">
          ${escapeHtml(label)}
        </div>

        <div class="data-value">
          ${escapeHtml(value)}
        </div>

        <div></div>
      `;

      container.appendChild(row);
    });
}


function renderDatedRows(
  container,
  items
) {
  container.innerHTML = "";

  sortDatedItems(items || [])
    .forEach(item => {
      const row =
        document.createElement("div");

      row.className = "data-row";

      row.innerHTML = `
        <div class="data-label">
          ${escapeHtml(item.type)}
        </div>

        <div class="data-value">
          ${escapeHtml(item.value)}
        </div>

        <div class="data-date">
          ${escapeHtml(item.date)}
        </div>
      `;

      container.appendChild(row);
    });
}


function renderContactInfo(contact) {
  renderDatedRows(
    $("contactInfo"),
    contact.contactData
  );
}

function renderPersonalInfo(contact) {
  renderDatedRows(
    $("personalInfo"),
    contact.personalData
  );
}

function renderCustomFields(contact) {
  renderDatedRows(
    $("customFields"),
    contact.customFields
  );
}


function renderNotes(contact) {
  const container =
    $("notesList");

  container.innerHTML = "";

  sortDatedItems(contact.notes || [])
    .forEach(note => {
      const item =
        document.createElement("div");

      item.className =
        "note-item";

      item.innerHTML = `
        <div class="note-text">
          ${escapeHtml(note.text)}
        </div>

        <div class="note-date">
          ${escapeHtml(note.date)}
        </div>
      `;

      container.appendChild(item);
    });
}


function renderComment(contact) {
  $("contactComment").textContent =
    contact.comment || "";
}


/* =========================================================
   RELATIONS
   ========================================================= */

function relationLabel(type) {
  const labels = {
    father: "Отец",
    mother: "Мать",
    son: "Сын",
    daughter: "Дочь",
    brother: "Брат",
    sister: "Сестра",
    spouse: "Супруг / супруга",
    friend: "Друг / знакомый",
    other: "Другая связь"
  };

  return labels[type] || type;
}


function renderRelations(contact) {
  const container =
    $("relationsList");

  container.innerHTML = "";

  const alreadyRendered =
    new Set();

  (contact.relations || [])
    .forEach(relation => {
      const target =
        getContact(relation.contactId);

      if (!target) {
        return;
      }

      const key =
        `${relation.type}:${target.id}`;

      if (alreadyRendered.has(key)) {
        return;
      }

      alreadyRendered.add(key);

      const row =
        document.createElement("div");

      row.className =
        "relation-item";

      const type =
        document.createElement("div");

      type.className =
        "relation-type";

      type.textContent =
        relationLabel(relation.type);

      const link =
        document.createElement("a");

      link.href = "#";
      link.className =
        "relation-link";

      link.textContent =
        shortName(target);

      link.onclick = event => {
        event.preventDefault();
        openContact(target.id);
      };

      row.append(type, link);
      container.appendChild(row);
    });
}


function reverseRelationType(
  type,
  sourceGender
) {
  switch (type) {
    case "father":
    case "mother":
      if (sourceGender === "female") {
        return "daughter";
      }

      if (sourceGender === "male") {
        return "son";
      }

      return "other";

    case "son":
    case "daughter":
      if (sourceGender === "female") {
        return "mother";
      }

      if (sourceGender === "male") {
        return "father";
      }

      return "other";

    case "brother":
    case "sister":
      if (sourceGender === "female") {
        return "sister";
      }

      if (sourceGender === "male") {
        return "brother";
      }

      return "other";

    case "spouse":
      return "spouse";

    case "friend":
      return "friend";

    default:
      return "other";
  }
}


function removeAutomaticReverseRelations(
  sourceId
) {
  database.contacts.forEach(contact => {
    contact.relations =
      (contact.relations || [])
        .filter(
          relation =>
            relation.autoSourceId !==
            sourceId
        );
  });
}


function createAutomaticReverseRelations(
  source
) {
  (source.relations || [])
    .filter(relation => !relation.auto)
    .forEach(relation => {
      const target =
        getContact(relation.contactId);

      if (!target) {
        return;
      }

      target.relations ||= [];

      const reverseType =
        reverseRelationType(
          relation.type,
          source.gender
        );

      const alreadyExists =
        target.relations.some(
          item =>
            item.contactId === source.id &&
            item.type === reverseType
        );

      if (alreadyExists) {
        return;
      }

      target.relations.push({
        id: uuid(),
        type: reverseType,
        contactId: source.id,
        auto: true,
        autoSourceId: source.id
      });
    });
}


/* =========================================================
   PHOTOS
   ========================================================= */

async function loadPhotoIntoImage(
  img,
  fileId
) {
  try {
    if (photoUrls.has(fileId)) {
      img.src =
        photoUrls.get(fileId);

      return;
    }

    const url =
      await DriveAPI
        .getPhotoObjectUrl(fileId);

    photoUrls.set(fileId, url);

    img.src = url;

  } catch (error) {
    console.error(error);
  }
}


async function renderPhotos(contact) {
  const gallery =
    $("photoGallery");

  gallery.innerHTML = "";

  const photos =
    contact.photos || [];

  photos.forEach(
    (photo, index) => {
      const wrapper =
        document.createElement("div");

      const item =
        document.createElement("div");

      item.className = "photo-item";

      const img =
        document.createElement("img");

      img.alt =
        photo.name || "Фото";

      loadPhotoIntoImage(
        img,
        photo.fileId
      );

      item.appendChild(img);

      item.onclick = () =>
        openPhotoViewer(
          contact,
          index
        );

      const controls =
        document.createElement("div");

      controls.style.display = "flex";
      controls.style.gap = "5px";
      controls.style.marginTop = "5px";


      const profileBtn =
        document.createElement("button");

      profileBtn.className =
        "secondary-btn";

      profileBtn.style.flex = "1";
      profileBtn.style.fontSize = "12px";

      profileBtn.textContent =
        contact.profilePhotoId ===
        photo.fileId
          ? "Профильное"
          : "На профиль";

      profileBtn.onclick =
        async event => {
          event.stopPropagation();

          contact.profilePhotoId =
            photo.fileId;

          await persistDatabase();

          renderContacts();
          await openContact(contact.id);
        };


      const deleteBtn =
        document.createElement("button");

      deleteBtn.className =
        "danger-btn";

      deleteBtn.style.fontSize =
        "12px";

      deleteBtn.textContent =
        "Удалить";

      deleteBtn.onclick =
        async event => {
          event.stopPropagation();

          if (
            !confirm(
              "Удалить фотографию?"
            )
          ) {
            return;
          }

          try {
            await DriveAPI
              .deleteDriveFile(
                photo.fileId
              );

            const oldUrl =
              photoUrls.get(
                photo.fileId
              );

            if (oldUrl) {
              URL.revokeObjectURL(oldUrl);
              photoUrls.delete(
                photo.fileId
              );
            }

            contact.photos =
              contact.photos.filter(
                item =>
                  item.fileId !==
                  photo.fileId
              );

            if (
              contact.profilePhotoId ===
              photo.fileId
            ) {
              contact.profilePhotoId =
                null;
            }

            await persistDatabase();

            renderContacts();

            await openContact(
              contact.id
            );

          } catch (error) {
            alert(error.message);
          }
        };

      controls.append(
        profileBtn,
        deleteBtn
      );

      wrapper.append(
        item,
        controls
      );

      gallery.appendChild(wrapper);
    }
  );
}


async function uploadFilesToContact(
  contact,
  files,
  makeFirstProfile = false
) {
  if (!files?.length) {
    return;
  }

  const folderId =
    await DriveAPI
      .getOrCreateContactPhotoFolder(
        contact.id
      );

  contact.photos ||= [];

  let firstFileId = null;

  for (const file of files) {
    const uploaded =
      await DriveAPI.uploadPhoto(
        file,
        folderId
      );

    contact.photos.push({
      id: uuid(),
      fileId: uploaded.id,
      name: uploaded.name,
      mimeType:
        uploaded.mimeType ||
        file.type,
      createdAt:
        uploaded.createdTime ||
        new Date().toISOString()
    });

    if (!firstFileId) {
      firstFileId =
        uploaded.id;
    }
  }

  if (
    makeFirstProfile &&
    firstFileId
  ) {
    contact.profilePhotoId =
      firstFileId;
  }
}


async function uploadSelectedPhotos(files) {
  const contact =
    getContact(currentContactId);

  if (!contact || !files.length) {
    return;
  }

  try {
    showSync(
      "Загрузка фотографий..."
    );

    await uploadFilesToContact(
      contact,
      files,
      !contact.profilePhotoId
    );

    await persistDatabase();

    renderContacts();

    await openContact(
      contact.id
    );

  } catch (error) {
    console.error(error);
    alert(error.message);
  }

  $("photoInput").value = "";
}


/* =========================================================
   PHOTO VIEWER
   ========================================================= */

async function openPhotoViewer(
  contact,
  index
) {
  viewerPhotos =
    contact.photos || [];

  viewerPhotoIndex =
    index;

  $("photoViewer")
    .classList
    .remove("hidden");

  await renderViewerPhoto();
}


async function renderViewerPhoto() {
  if (!viewerPhotos.length) {
    return;
  }

  const photo =
    viewerPhotos[
      viewerPhotoIndex
    ];

  const img =
    $("photoViewerImage");

  if (photoUrls.has(photo.fileId)) {
    img.src =
      photoUrls.get(photo.fileId);

  } else {
    const url =
      await DriveAPI
        .getPhotoObjectUrl(
          photo.fileId
        );

    photoUrls.set(
      photo.fileId,
      url
    );

    img.src = url;
  }

  $("photoViewerCounter")
    .textContent =
    `${viewerPhotoIndex + 1} / ${viewerPhotos.length}`;
}


/* =========================================================
   EMPTY CONTACT
   ========================================================= */

function createBlankContact() {
  return {
    id: uuid(),

    firstName: "",
    lastName: "",
    middleName: "",

    gender: "",

    birthDate: "",
    deathDate: "",

    birthPlace: "",
    deathPlace: "",

    category: "",

    tags: [],

    contactData: [],
    personalData: [],
    customFields: [],

    notes: [],

    comment: "",

    relations: [],

    photos: [],

    profilePhotoId: null,

    createdAt:
      new Date().toISOString(),

    updatedAt:
      new Date().toISOString()
  };
}


/* =========================================================
   CONTACT FORM
   ========================================================= */

function openContactForm(
  contactId = null
) {
  editingContactId =
    contactId;

  pendingProfilePhoto =
    null;

  removeProfilePhoto =
    false;

  if (localProfilePreviewUrl) {
    URL.revokeObjectURL(
      localProfilePreviewUrl
    );

    localProfilePreviewUrl =
      null;
  }

  const contact =
    contactId
      ? getContact(contactId)
      : createBlankContact();

  formContactId =
    contact.id;

  $("contactModalTitle")
    .textContent =
    contactId
      ? "Редактировать контакт"
      : "Новый контакт";

  $("contactFormContent")
    .innerHTML =
    buildContactForm(contact);

  $("formAdditionalPhotosInput").value =
    "";

  $("profilePhotoInput").value =
    "";

  renderFormProfilePhoto(contact);

  bindDynamicFormButtons();

  $("contactModal")
    .classList
    .remove("hidden");
}


async function renderFormProfilePhoto(
  contact
) {
  const preview =
    $("formProfilePhotoPreview");

  const placeholder =
    $("formProfilePhotoPlaceholder");

  preview.src = "";

  if (contact.profilePhotoId) {
    placeholder.classList.add(
      "hidden"
    );

    preview.classList.remove(
      "hidden"
    );

    await loadPhotoIntoImage(
      preview,
      contact.profilePhotoId
    );

  } else {
    preview.classList.add(
      "hidden"
    );

    placeholder.classList.remove(
      "hidden"
    );
  }
}


function buildContactForm(contact) {
  return `

    <section class="form-section">

      <h3>Основные данные</h3>

      <div class="form-grid">

        ${textField(
          "firstName",
          "Имя",
          contact.firstName
        )}

        ${textField(
          "lastName",
          "Фамилия",
          contact.lastName
        )}

        ${textField(
          "middleName",
          "Отчество / другие имена",
          contact.middleName,
          true
        )}

        <div class="form-field">

          <label class="form-label">
            Пол
          </label>

          <select
            class="form-select"
            name="gender"
          >
            <option value="">
              Не указано
            </option>

            <option
              value="male"
              ${contact.gender === "male" ? "selected" : ""}
            >
              Мужской
            </option>

            <option
              value="female"
              ${contact.gender === "female" ? "selected" : ""}
            >
              Женский
            </option>

            <option
              value="unknown"
              ${contact.gender === "unknown" ? "selected" : ""}
            >
              Неизвестно
            </option>

          </select>

        </div>

        ${dateField(
          "birthDate",
          "Дата рождения",
          contact.birthDate
        )}

        ${dateField(
          "deathDate",
          "Дата смерти",
          contact.deathDate
        )}

        ${textField(
          "birthPlace",
          "Место рождения",
          contact.birthPlace
        )}

        ${textField(
          "deathPlace",
          "Место смерти",
          contact.deathPlace
        )}

        ${textField(
          "category",
          "Категория",
          contact.category
        )}

        ${textField(
          "tags",
          "Теги через запятую",
          (contact.tags || [])
            .join(", ")
        )}

      </div>

    </section>


    ${dynamicSection(
      "Контактные данные",
      "contactData",
      contact.contactData,
      [
        "Телефон",
        "E-Mail",
        "Адрес"
      ]
    )}


    ${dynamicSection(
      "Личная информация",
      "personalData",
      contact.personalData,
      [
        "Откуда знакомы",
        "Увлечения",
        "Размер обуви",
        "Размер одежды",
        "Работа / фирма",
        "Образование"
      ]
    )}


    ${dynamicSection(
      "Дополнительная информация",
      "customFields",
      contact.customFields,
      []
    )}


    <section class="form-section">

      <h3>Заметки</h3>

      <div
        id="notesRows"
        class="dynamic-container"
      >
        ${(contact.notes || [])
          .map(note =>
            noteRow(note)
          )
          .join("")}
      </div>

      <button
        type="button"
        class="add-row-btn"
        data-add-note
      >
        + Добавить заметку
      </button>

    </section>


    <section class="form-section">

      <h3>Комментарий</h3>

      <textarea
        class="form-textarea"
        name="comment"
        placeholder="Свободный комментарий"
      >${escapeHtml(contact.comment)}</textarea>

    </section>


    <section class="form-section">

      <h3>Связи</h3>

      <div
        id="relationsRows"
        class="dynamic-container"
      >
        ${(contact.relations || [])
          .filter(relation =>
            !relation.auto
          )
          .map(relation =>
            relationRow(
              relation,
              contact.id
            )
          )
          .join("")}
      </div>

      <button
        type="button"
        class="add-row-btn"
        data-add-relation
        data-current-contact="${contact.id}"
      >
        + Добавить связь
      </button>

    </section>
  `;
}


function textField(
  name,
  label,
  value,
  full = false
) {
  return `
    <div class="form-field ${full ? "full" : ""}">

      <label class="form-label">
        ${escapeHtml(label)}
      </label>

      <input
        class="form-input"
        name="${name}"
        value="${escapeHtml(value)}"
      >

    </div>
  `;
}


function dateField(
  name,
  label,
  value
) {
  return `
    <div class="form-field">

      <label class="form-label">
        ${escapeHtml(label)}
      </label>

      <input
        class="form-input"
        type="date"
        name="${name}"
        value="${escapeHtml(value)}"
      >

    </div>
  `;
}


/* =========================================================
   DYNAMIC FORM
   ========================================================= */

function dynamicSection(
  title,
  name,
  rows,
  presets
) {
  return `
    <section class="form-section">

      <h3>${escapeHtml(title)}</h3>

      <div
        id="${name}Rows"
        class="dynamic-container"
        data-presets="${escapeHtml(
          JSON.stringify(presets)
        )}"
      >
        ${(rows || [])
          .map(row =>
            dynamicRow(
              row,
              presets
            )
          )
          .join("")}
      </div>

      <button
        type="button"
        class="add-row-btn"
        data-add-row="${name}"
      >
        + Добавить
      </button>

    </section>
  `;
}


function dynamicRow(
  row = {},
  presets = []
) {
  const listId =
    `list-${uuid()}`;

  return `
    <div class="dynamic-row">

      <input
        class="form-input dynamic-type"
        placeholder="Поле"
        value="${escapeHtml(row.type)}"
        list="${listId}"
      >

      <datalist id="${listId}">
        ${presets
          .map(
            preset =>
              `<option value="${escapeHtml(preset)}"></option>`
          )
          .join("")}
      </datalist>

      <input
        class="form-input dynamic-value"
        placeholder="Значение"
        value="${escapeHtml(row.value)}"
      >

      <input
        class="form-input dynamic-date"
        placeholder="Дата / период"
        value="${escapeHtml(row.date)}"
      >

      <button
        type="button"
        class="remove-row-btn"
        data-remove-row
      >
        ×
      </button>

    </div>
  `;
}


function noteRow(note = {}) {
  return `
    <div class="dynamic-row dynamic-row-note">

      <textarea
        class="form-textarea note-text-input"
        placeholder="Заметка"
      >${escapeHtml(note.text)}</textarea>

      <input
        class="form-input note-date-input"
        placeholder="Дата / период"
        value="${escapeHtml(note.date)}"
      >

      <button
        type="button"
        class="remove-row-btn"
        data-remove-row
      >
        ×
      </button>

    </div>
  `;
}


function relationRow(
  relation = {},
  currentId
) {
  const contacts =
    database.contacts
      .filter(
        contact =>
          contact.id !== currentId
      )
      .sort(
        (a, b) =>
          fullName(a)
            .localeCompare(
              fullName(b),
              "ru"
            )
      );

  return `
    <div class="dynamic-row relation-form-row">

      <select
        class="form-select relation-type-input"
      >
        ${relationOption("father", "Отец", relation.type)}
        ${relationOption("mother", "Мать", relation.type)}
        ${relationOption("son", "Сын", relation.type)}
        ${relationOption("daughter", "Дочь", relation.type)}
        ${relationOption("brother", "Брат", relation.type)}
        ${relationOption("sister", "Сестра", relation.type)}
        ${relationOption("spouse", "Супруг / супруга", relation.type)}
        ${relationOption("friend", "Друг / знакомый", relation.type)}
        ${relationOption("other", "Другая связь", relation.type)}
      </select>

      <select
        class="form-select relation-contact-input"
      >

        <option value="">
          Выберите контакт
        </option>

        ${contacts
          .map(contact => `
            <option
              value="${contact.id}"
              ${relation.contactId === contact.id ? "selected" : ""}
            >
              ${escapeHtml(
                shortName(contact)
              )}
            </option>
          `)
          .join("")}

      </select>

      <div></div>

      <button
        type="button"
        class="remove-row-btn"
        data-remove-row
      >
        ×
      </button>

    </div>
  `;
}


function relationOption(
  value,
  label,
  selected
) {
  return `
    <option
      value="${value}"
      ${value === selected ? "selected" : ""}
    >
      ${label}
    </option>
  `;
}


function bindDynamicFormButtons() {
  document
    .querySelectorAll(
      "[data-remove-row]"
    )
    .forEach(button => {
      button.onclick = () => {
        button
          .closest(".dynamic-row")
          .remove();
      };
    });


  document
    .querySelectorAll(
      "[data-add-row]"
    )
    .forEach(button => {
      button.onclick = () => {
        const name =
          button.dataset.addRow;

        const container =
          $(`${name}Rows`);

        const presets =
          JSON.parse(
            container.dataset.presets ||
            "[]"
          );

        container.insertAdjacentHTML(
          "beforeend",
          dynamicRow({}, presets)
        );

        bindDynamicFormButtons();
      };
    });


  const addNote =
    document.querySelector(
      "[data-add-note]"
    );

  if (addNote) {
    addNote.onclick = () => {
      $("notesRows")
        .insertAdjacentHTML(
          "beforeend",
          noteRow()
        );

      bindDynamicFormButtons();
    };
  }


  const addRelation =
    document.querySelector(
      "[data-add-relation]"
    );

  if (addRelation) {
    addRelation.onclick = () => {
      $("relationsRows")
        .insertAdjacentHTML(
          "beforeend",
          relationRow(
            {},
            addRelation.dataset
              .currentContact
          )
        );

      bindDynamicFormButtons();
    };
  }
}


/* =========================================================
   READ FORM
   ========================================================= */

function readDynamicRows(containerId) {
  return [
    ...$(containerId)
      .querySelectorAll(".dynamic-row")
  ]
    .map(row => ({
      id: uuid(),

      type:
        row.querySelector(
          ".dynamic-type"
        )?.value.trim() || "",

      value:
        row.querySelector(
          ".dynamic-value"
        )?.value.trim() || "",

      date:
        row.querySelector(
          ".dynamic-date"
        )?.value.trim() || ""
    }))
    .filter(
      item =>
        item.type ||
        item.value ||
        item.date
    );
}


function readNotes() {
  return [
    ...$("notesRows")
      .querySelectorAll(".dynamic-row")
  ]
    .map(row => ({
      id: uuid(),

      text:
        row.querySelector(
          ".note-text-input"
        )?.value.trim() || "",

      date:
        row.querySelector(
          ".note-date-input"
        )?.value.trim() || ""
    }))
    .filter(
      note =>
        note.text ||
        note.date
    );
}


function readRelations() {
  return [
    ...$("relationsRows")
      .querySelectorAll(
        ".relation-form-row"
      )
  ]
    .map(row => ({
      id: uuid(),

      type:
        row.querySelector(
          ".relation-type-input"
        ).value,

      contactId:
        row.querySelector(
          ".relation-contact-input"
        ).value,

      auto: false
    }))
    .filter(
      relation =>
        relation.contactId
    );
}


/* =========================================================
   PROFILE PHOTO IN FORM
   ========================================================= */

function selectProfilePhoto(file) {
  if (!file) {
    return;
  }

  pendingProfilePhoto =
    file;

  removeProfilePhoto =
    false;

  if (localProfilePreviewUrl) {
    URL.revokeObjectURL(
      localProfilePreviewUrl
    );
  }

  localProfilePreviewUrl =
    URL.createObjectURL(file);

  const preview =
    $("formProfilePhotoPreview");

  preview.src =
    localProfilePreviewUrl;

  preview.classList.remove(
    "hidden"
  );

  $("formProfilePhotoPlaceholder")
    .classList.add(
      "hidden"
    );
}


function clearProfilePhotoFromForm() {
  pendingProfilePhoto =
    null;

  removeProfilePhoto =
    true;

  if (localProfilePreviewUrl) {
    URL.revokeObjectURL(
      localProfilePreviewUrl
    );

    localProfilePreviewUrl =
      null;
  }

  $("formProfilePhotoPreview")
    .classList.add("hidden");

  $("formProfilePhotoPlaceholder")
    .classList.remove("hidden");
}


/* =========================================================
   SAVE CONTACT
   ========================================================= */

async function saveContactForm(event) {
  event.preventDefault();

  const form =
    new FormData(
      $("contactForm")
    );

  let contact =
    editingContactId
      ? getContact(editingContactId)
      : createBlankContact();

  if (!contact) {
    return;
  }

  if (!editingContactId) {
    contact.id =
      formContactId;
  }


  removeAutomaticReverseRelations(
    contact.id
  );


  contact.firstName =
    safe(form.get("firstName"))
      .trim();

  contact.lastName =
    safe(form.get("lastName"))
      .trim();

  contact.middleName =
    safe(form.get("middleName"))
      .trim();

  contact.gender =
    safe(form.get("gender"));

  contact.birthDate =
    safe(form.get("birthDate"));

  contact.deathDate =
    safe(form.get("deathDate"));

  contact.birthPlace =
    safe(form.get("birthPlace"))
      .trim();

  contact.deathPlace =
    safe(form.get("deathPlace"))
      .trim();

  contact.category =
    safe(form.get("category"))
      .trim();

  contact.tags =
    safe(form.get("tags"))
      .split(",")
      .map(tag => tag.trim())
      .filter(Boolean);

  contact.contactData =
    readDynamicRows(
      "contactDataRows"
    );

  contact.personalData =
    readDynamicRows(
      "personalDataRows"
    );

  contact.customFields =
    readDynamicRows(
      "customFieldsRows"
    );

  contact.notes =
    readNotes();

  contact.comment =
    safe(form.get("comment"))
      .trim();

  contact.relations =
    readRelations();

  contact.updatedAt =
    new Date().toISOString();


  if (!editingContactId) {
    database.contacts.push(
      contact
    );
  }


  try {
    showSync("Сохранение...");


    /* Убрать профильную картинку */
    if (removeProfilePhoto) {
      contact.profilePhotoId =
        null;
    }


    /* Новая профильная фотография */
    if (pendingProfilePhoto) {
      await uploadFilesToContact(
        contact,
        [pendingProfilePhoto],
        true
      );
    }


    /* Дополнительные фото */
    const additionalPhotos = [
      ...$("formAdditionalPhotosInput")
        .files
    ];

    if (additionalPhotos.length) {
      await uploadFilesToContact(
        contact,
        additionalPhotos,
        false
      );

      if (
        !contact.profilePhotoId &&
        contact.photos.length
      ) {
        contact.profilePhotoId =
          contact.photos[0].fileId;
      }
    }


    createAutomaticReverseRelations(
      contact
    );

    await persistDatabase();

    closeContactModal();

    renderContacts();

    await openContact(
      contact.id
    );

  } catch (error) {
    console.error(error);
    alert(error.message);
  }
}


/* =========================================================
   TRASH
   ========================================================= */

async function moveContactToTrash(id) {
  const index =
    database.contacts.findIndex(
      contact =>
        contact.id === id
    );

  if (index === -1) {
    return;
  }

  const contact =
    database.contacts[index];

  if (
    !confirm(
      `Переместить "${shortName(contact)}" в корзину?`
    )
  ) {
    return;
  }

  database.contacts.splice(
    index,
    1
  );

  contact.deletedAt =
    new Date().toISOString();

  database.trash.push(contact);

  /*
    Связи специально НЕ удаляем.
    При восстановлении они снова заработают.
  */

  await persistDatabase();

  currentContactId = null;

  renderContacts();
  showPage("contacts");
}


function renderTrash() {
  const list =
    $("trashList");

  list.innerHTML = "";

  $("emptyTrash")
    .classList.toggle(
      "hidden",
      database.trash.length !== 0
    );

  database.trash.forEach(contact => {
    const item =
      document.createElement("div");

    item.className =
      "contact-list-item";

    const main =
      document.createElement("div");

    main.className =
      "contact-list-main";

    main.innerHTML = `
      <div class="contact-list-name">
        ${escapeHtml(
          shortName(contact)
        )}
      </div>

      <div class="contact-list-meta">
        Удалён:
        ${escapeHtml(
          contact.deletedAt || ""
        )}
      </div>
    `;


    const buttons =
      document.createElement("div");

    buttons.style.marginLeft =
      "auto";

    buttons.style.display =
      "flex";

    buttons.style.gap =
      "6px";


    const restore =
      document.createElement("button");

    restore.className =
      "secondary-btn";

    restore.textContent =
      "Восстановить";

    restore.onclick =
      async event => {
        event.stopPropagation();

        await restoreContact(
          contact.id
        );
      };


    const remove =
      document.createElement("button");

    remove.className =
      "danger-btn";

    remove.textContent =
      "Удалить окончательно";

    remove.onclick =
      async event => {
        event.stopPropagation();

        await permanentlyDeleteContact(
          contact.id
        );
      };


    buttons.append(
      restore,
      remove
    );

    item.append(
      main,
      buttons
    );

    list.appendChild(item);
  });
}


async function restoreContact(id) {
  const index =
    database.trash.findIndex(
      contact =>
        contact.id === id
    );

  if (index === -1) {
    return;
  }

  const contact =
    database.trash.splice(
      index,
      1
    )[0];

  delete contact.deletedAt;

  database.contacts.push(
    contact
  );

  await persistDatabase();

  renderTrash();
  renderContacts();
}


async function permanentlyDeleteContact(id) {
  const contact =
    database.trash.find(
      item =>
        item.id === id
    );

  if (!contact) {
    return;
  }

  if (
    !confirm(
      `Окончательно удалить "${shortName(contact)}"?`
    )
  ) {
    return;
  }


  for (
    const photo of
    contact.photos || []
  ) {
    try {
      await DriveAPI
        .deleteDriveFile(
          photo.fileId
        );
    } catch (error) {
      console.warn(error);
    }
  }


  /* Удаляем ссылки */
  [
    ...database.contacts,
    ...database.trash
  ].forEach(item => {
    item.relations =
      (item.relations || [])
        .filter(
          relation =>
            relation.contactId !== id
        );
  });


  database.trash =
    database.trash.filter(
      item =>
        item.id !== id
    );

  await persistDatabase();

  renderTrash();
}


/* =========================================================
   VCARD EXPORT
   ========================================================= */

function vcardEscape(value) {
  return safe(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}


function exportCurrentContact() {
  const contact =
    getContact(currentContactId);

  if (!contact) {
    return;
  }

  const phone =
    getLatestStandardItem(
      contact.contactData,
      "phone"
    );

  const email =
    getLatestStandardItem(
      contact.contactData,
      "email"
    );

  const address =
    getLatestStandardItem(
      contact.contactData,
      "address"
    );

  const company =
    getLatestStandardItem(
      contact.personalData,
      "company"
    );


  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",

    `N:${vcardEscape(contact.lastName)};${vcardEscape(contact.firstName)};${vcardEscape(contact.middleName)};;`,

    `FN:${vcardEscape(
      shortName(contact)
    )}`
  ];


  if (phone?.value) {
    lines.push(
      `TEL;TYPE=CELL:${vcardEscape(phone.value)}`
    );
  }

  if (email?.value) {
    lines.push(
      `EMAIL;TYPE=INTERNET:${vcardEscape(email.value)}`
    );
  }

  if (address?.value) {
    lines.push(
      `ADR;TYPE=HOME:;;${vcardEscape(address.value)};;;;`
    );
  }

  if (company?.value) {
    lines.push(
      `ORG:${vcardEscape(company.value)}`
    );
  }

  if (contact.birthDate) {
    lines.push(
      `BDAY:${contact.birthDate.replaceAll("-", "")}`
    );
  }

  if (contact.comment) {
    lines.push(
      `NOTE:${vcardEscape(contact.comment)}`
    );
  }

  lines.push(
    "END:VCARD"
  );


  const blob =
    new Blob(
      [lines.join("\r\n")],
      {
        type:
          "text/vcard;charset=utf-8"
      }
    );

  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement("a");

  const filename =
    (
      shortName(contact) ||
      "contact"
    )
      .replace(
        /[\\/:*?"<>|]/g,
        "_"
      );

  link.href = url;
  link.download =
    `${filename}.vcf`;

  document.body.appendChild(
    link
  );

  link.click();
  link.remove();

  setTimeout(
    () =>
      URL.revokeObjectURL(url),
    1000
  );
}


/* =========================================================
   FAMILY GRAPH
   ========================================================= */

function familyRelationDelta(type) {
  switch (type) {
    case "father":
    case "mother":
      return -1;

    case "son":
    case "daughter":
      return 1;

    case "brother":
    case "sister":
    case "spouse":
      return 0;

    default:
      return null;
  }
}


function buildFamilyGraph() {
  const graph =
    new Map();

  database.contacts.forEach(contact => {
    graph.set(
      contact.id,
      []
    );
  });


  database.contacts.forEach(source => {
    (source.relations || [])
      .forEach(relation => {
        if (
          !graph.has(
            relation.contactId
          )
        ) {
          return;
        }

        const delta =
          familyRelationDelta(
            relation.type
          );

        if (delta === null) {
          return;
        }

        graph.get(source.id).push({
          targetId:
            relation.contactId,
          delta,
          type:
            relation.type
        });

        /*
          Обратное ребро создаём в памяти,
          даже если его нет в JSON.
        */
        graph.get(
          relation.contactId
        ).push({
          targetId:
            source.id,
          delta:
            -delta,
          type:
            relation.type
        });
      });
  });

  return graph;
}


/* =========================================================
   FAMILY ROOT
   ========================================================= */

function renderFamilyRootSelect() {
  const select =
    $("familyRootSelect");

  const current =
    database.settings
      .familyRootId || "";

  select.innerHTML =
    '<option value="">Выберите человека</option>';

  [...database.contacts]
    .sort(
      (a, b) =>
        fullName(a)
          .localeCompare(
            fullName(b),
            "ru"
          )
    )
    .forEach(contact => {
      const option =
        document.createElement(
          "option"
        );

      option.value =
        contact.id;

      option.textContent =
        shortName(contact);

      select.appendChild(
        option
      );
    });

  if (
    database.contacts.some(
      contact =>
        contact.id === current
    )
  ) {
    select.value = current;
  }
}


/* =========================================================
   FAMILY TREE
   ========================================================= */

function renderFamilyTree() {
  const container =
    $("familyTree");

  container.innerHTML = "";

  const rootId =
    $("familyRootSelect").value;

  if (!rootId) {
    container.textContent =
      "Выберите центрального человека.";

    return;
  }


  const graph =
    buildFamilyGraph();

  if (!graph.has(rootId)) {
    return;
  }


  /*
    BFS: определяем поколение относительно
    центрального человека.
  */

  const levels =
    new Map();

  const queue =
    [rootId];

  levels.set(
    rootId,
    0
  );


  while (queue.length) {
    const sourceId =
      queue.shift();

    const sourceLevel =
      levels.get(sourceId);

    for (
      const edge of
      graph.get(sourceId) || []
    ) {
      if (
        !levels.has(
          edge.targetId
        )
      ) {
        levels.set(
          edge.targetId,
          sourceLevel +
          edge.delta
        );

        queue.push(
          edge.targetId
        );
      }
    }
  }


  const visibleIds =
    [...levels.keys()];


  const levelGroups =
    new Map();

  visibleIds.forEach(id => {
    const level =
      levels.get(id);

    if (!levelGroups.has(level)) {
      levelGroups.set(
        level,
        []
      );
    }

    levelGroups
      .get(level)
      .push(id);
  });


  levelGroups.forEach(ids => {
    ids.sort((idA, idB) => {
      const a = getContact(idA);
      const b = getContact(idB);

      if (!a || !b) {
        return 0;
      }

      /*
        Центрального человека ставим первым
        в своей колонке.
      */
      if (idA === rootId) {
        return -1;
      }

      if (idB === rootId) {
        return 1;
      }

      return fullName(a)
        .localeCompare(
          fullName(b),
          "ru"
        );
    });
  });


  const levelValues =
    [...levelGroups.keys()]
      .sort((a, b) => a - b);


  const nodeWidth = 170;
  const nodeHeight = 135;

  const columnGap = 160;
  const rowGap = 45;

  const paddingX = 70;
  const paddingY = 40;

  const maxRows =
    Math.max(
      ...[...levelGroups.values()]
        .map(group => group.length),
      1
    );

  const canvasWidth =
    paddingX * 2 +
    levelValues.length *
      nodeWidth +
    Math.max(
      0,
      levelValues.length - 1
    ) *
      columnGap;

  const canvasHeight =
    Math.max(
      500,
      paddingY * 2 +
      maxRows *
        nodeHeight +
      Math.max(
        0,
        maxRows - 1
      ) *
        rowGap
    );


  const canvas =
    document.createElement("div");

  canvas.className =
    "family-tree-canvas";

  canvas.style.width =
    `${canvasWidth}px`;

  canvas.style.height =
    `${canvasHeight}px`;


  const svg =
    document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg"
    );

  svg.setAttribute(
    "class",
    "family-tree-lines"
  );

  svg.setAttribute(
    "viewBox",
    `0 0 ${canvasWidth} ${canvasHeight}`
  );


  const positions =
    new Map();


  levelValues.forEach(
    (level, columnIndex) => {
      const ids =
        levelGroups.get(level);

      const totalHeight =
        ids.length *
          nodeHeight +
        Math.max(
          0,
          ids.length - 1
        ) *
          rowGap;

      const startY =
        Math.max(
          paddingY,
          (canvasHeight -
            totalHeight) /
            2
        );


      ids.forEach(
        (id, rowIndex) => {
          const x =
            paddingX +
            columnIndex *
              (
                nodeWidth +
                columnGap
              );

          const y =
            startY +
            rowIndex *
              (
                nodeHeight +
                rowGap
              );

          positions.set(
            id,
            {
              x,
              y,
              width: nodeWidth,
              height: nodeHeight
            }
          );
        }
      );
    }
  );


  /*
    Рисуем линии.
    Set не позволяет рисовать одну связь дважды.
  */

  const drawnEdges =
    new Set();

  visibleIds.forEach(sourceId => {
    for (
      const edge of
      graph.get(sourceId) || []
    ) {
      if (
        !positions.has(
          edge.targetId
        )
      ) {
        continue;
      }

      const key =
        [sourceId, edge.targetId]
          .sort()
          .join(":");

      if (
        drawnEdges.has(key)
      ) {
        continue;
      }

      drawnEdges.add(key);


      const a =
        positions.get(sourceId);

      const b =
        positions.get(
          edge.targetId
        );


      let x1;
      let y1;
      let x2;
      let y2;


      if (a.x < b.x) {
        x1 =
          a.x + a.width;

        y1 =
          a.y + a.height / 2;

        x2 =
          b.x;

        y2 =
          b.y + b.height / 2;

      } else if (a.x > b.x) {
        x1 =
          a.x;

        y1 =
          a.y + a.height / 2;

        x2 =
          b.x + b.width;

        y2 =
          b.y + b.height / 2;

      } else {
        x1 =
          a.x + a.width / 2;

        y1 =
          a.y + a.height;

        x2 =
          b.x + b.width / 2;

        y2 =
          b.y;
      }


      const path =
        document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path"
        );


      if (a.x !== b.x) {
        const middleX =
          (x1 + x2) / 2;

        path.setAttribute(
          "d",
          `M ${x1} ${y1}
           L ${middleX} ${y1}
           L ${middleX} ${y2}
           L ${x2} ${y2}`
        );

      } else {
        path.setAttribute(
          "d",
          `M ${x1} ${y1}
           L ${x2} ${y2}`
        );
      }


      path.setAttribute(
        "fill",
        "none"
      );

      path.setAttribute(
        "stroke",
        "#aeb6c2"
      );

      path.setAttribute(
        "stroke-width",
        "2"
      );

      svg.appendChild(path);
    }
  });


  canvas.appendChild(svg);


  /*
    Карточки добавляем после SVG,
    чтобы линии находились под ними.
  */

  visibleIds.forEach(id => {
    const contact =
      getContact(id);

    if (!contact) {
      return;
    }

    const position =
      positions.get(id);

    const node =
      createFamilyNode(
        contact
      );

    node.style.left =
      `${position.x}px`;

    node.style.top =
      `${position.y}px`;

    node.style.height =
      `${nodeHeight}px`;

    canvas.appendChild(node);
  });


  container.appendChild(canvas);


  /*
    Автоматически прокручиваем примерно
    к центральному человеку.
  */

  requestAnimationFrame(() => {
    const rootPosition =
      positions.get(rootId);

    if (!rootPosition) {
      return;
    }

    container.scrollLeft =
      Math.max(
        0,
        rootPosition.x -
        container.clientWidth / 2 +
        nodeWidth / 2
      );

    container.scrollTop =
      Math.max(
        0,
        rootPosition.y -
        container.clientHeight / 2 +
        nodeHeight / 2
      );
  });
}


function createFamilyNode(contact) {
  const node =
    document.createElement("div");

  node.className =
    "family-node";


  if (contact.profilePhotoId) {
    const img =
      document.createElement("img");

    img.className =
      "family-node-photo";

    img.alt = "";

    loadPhotoIntoImage(
      img,
      contact.profilePhotoId
    );

    node.appendChild(img);

  } else {
    const placeholder =
      document.createElement("div");

    placeholder.className =
      "family-node-placeholder";

    placeholder.textContent =
      initials(contact);

    node.appendChild(
      placeholder
    );
  }


  const name =
    document.createElement("div");

  name.className =
    "family-node-name";

  name.textContent =
    shortName(contact);


  const meta =
    document.createElement("div");

  meta.className =
    "family-node-meta";

  meta.textContent =
    lifeText(contact);


  node.append(
    name,
    meta
  );


  node.onclick = () =>
    openContact(
      contact.id
    );

  return node;
}


/* =========================================================
   MODAL
   ========================================================= */

function closeContactModal() {
  $("contactModal")
    .classList
    .add("hidden");

  editingContactId =
    null;

  formContactId =
    null;

  pendingProfilePhoto =
    null;

  removeProfilePhoto =
    false;

  if (localProfilePreviewUrl) {
    URL.revokeObjectURL(
      localProfilePreviewUrl
    );

    localProfilePreviewUrl =
      null;
  }
}


/* =========================================================
   LOGIN
   ========================================================= */

async function completeLogin() {
  database =
    await DriveAPI
      .loadDatabase();

  normalizeDatabase();

  $("loginScreen")
    .classList.add(
      "hidden"
    );

  $("app")
    .classList.remove(
      "hidden"
    );

  $("loginStatus")
    .textContent = "";

  renderContacts();

  showPage("contacts");
}


async function login() {
  $("loginStatus")
    .textContent =
    "Подключение к Google Drive...";

  try {
    await DriveAPI
      .loginWithGoogle();

    await completeLogin();

  } catch (error) {
    console.error(error);

    $("loginStatus")
      .textContent =
      error.message ||
      "Ошибка входа.";
  }
}


/*
   При обновлении страницы сначала пытаемся
   получить токен без дополнительного действия.
*/
async function tryAutomaticLogin() {
  $("loginStatus")
    .textContent =
    "Подключение...";

  try {
    await DriveAPI
      .loginWithGoogle();

    await completeLogin();

    return true;

  } catch (error) {
    console.log(
      "Автоматический вход недоступен.",
      error
    );

    $("loginStatus")
      .textContent = "";

    return false;
  }
}


/* =========================================================
   NORMALIZE DATABASE
   ========================================================= */

function normalizeDatabase() {
  database.contacts ||= [];
  database.trash ||= [];

  database.settings ||= {
    familyRootId: null
  };

  [
    ...database.contacts,
    ...database.trash
  ].forEach(contact => {
    contact.tags ||= [];

    contact.contactData ||= [];
    contact.personalData ||= [];
    contact.customFields ||= [];

    contact.notes ||= [];
    contact.relations ||= [];
    contact.photos ||= [];

    if (
      contact.profilePhotoId ===
      undefined
    ) {
      contact.profilePhotoId =
        null;
    }
  });
}


/* =========================================================
   EVENTS
   ========================================================= */

function bindEvents() {
  $("googleLoginBtn")
    .addEventListener(
      "click",
      login
    );


  $("logoutBtn")
    .addEventListener(
      "click",
      () => {
        DriveAPI.logoutGoogle();

        database = null;

        $("app")
          .classList.add(
            "hidden"
          );

        $("loginScreen")
          .classList.remove(
            "hidden"
          );
      }
    );


  $("homeBtn")
    .onclick = () => {
      renderContacts();
      showPage("contacts");
    };


  document
    .querySelectorAll("[data-page]")
    .forEach(button => {
      button.onclick = () => {
        const page =
          button.dataset.page;

        if (page === "contacts") {
          renderContacts();
        }

        if (page === "family") {
          renderFamilyRootSelect();
          renderFamilyTree();
        }

        showPage(page);
      };
    });


  $("addContactBtn")
    .onclick = () =>
      openContactForm();

  $("mobileAddContactBtn")
    .onclick = () =>
      openContactForm();


  $("editContactBtn")
    .onclick = () => {
      if (currentContactId) {
        openContactForm(
          currentContactId
        );
      }
    };


  $("deleteContactBtn")
    .onclick = () => {
      if (currentContactId) {
        moveContactToTrash(
          currentContactId
        );
      }
    };


  $("exportContactBtn")
    .onclick =
      exportCurrentContact;


  $("backToContactsBtn")
    .onclick = () => {
      renderContacts();
      showPage("contacts");
    };


  $("trashBtn")
    .onclick = () => {
      renderTrash();
      showPage("trash");
    };


  $("backFromTrashBtn")
    .onclick = () => {
      renderContacts();
      showPage("contacts");
    };


  $("contactSearch")
    .addEventListener(
      "input",
      renderContacts
    );


  $("categoryFilter")
    .addEventListener(
      "change",
      renderContacts
    );


  $("closeContactModalBtn")
    .onclick =
      closeContactModal;

  $("cancelContactBtn")
    .onclick =
      closeContactModal;


  $("contactModal")
    .querySelector(
      ".modal-backdrop"
    )
    .onclick =
      closeContactModal;


  $("contactForm")
    .addEventListener(
      "submit",
      saveContactForm
    );


  $("selectProfilePhotoBtn")
    .onclick = () =>
      $("profilePhotoInput")
        .click();


  $("profilePhotoInput")
    .onchange = event => {
      selectProfilePhoto(
        event.target.files[0]
      );
    };


  $("removeProfilePhotoBtn")
    .onclick =
      clearProfilePhotoFromForm;


  $("addPhotoBtn")
    .onclick = () =>
      $("photoInput").click();


  $("photoInput")
    .onchange = event =>
      uploadSelectedPhotos(
        [...event.target.files]
      );


  $("closePhotoViewerBtn")
    .onclick = () =>
      $("photoViewer")
        .classList.add(
          "hidden"
        );


  $("previousPhotoBtn")
    .onclick = async () => {
      if (!viewerPhotos.length) {
        return;
      }

      viewerPhotoIndex =
        (
          viewerPhotoIndex -
          1 +
          viewerPhotos.length
        ) %
        viewerPhotos.length;

      await renderViewerPhoto();
    };


  $("nextPhotoBtn")
    .onclick = async () => {
      if (!viewerPhotos.length) {
        return;
      }

      viewerPhotoIndex =
        (
          viewerPhotoIndex +
          1
        ) %
        viewerPhotos.length;

      await renderViewerPhoto();
    };


  $("familyRootSelect")
    .onchange = async () => {
      database.settings
        .familyRootId =
        $("familyRootSelect")
          .value || null;

      await persistDatabase();

      renderFamilyTree();
    };


  $("refreshFamilyTreeBtn")
    .onclick = async () => {
      try {
        showSync(
          "Обновление..."
        );

        database =
          await DriveAPI
            .loadDatabase();

        normalizeDatabase();

        renderFamilyRootSelect();
        renderFamilyTree();

        showSync("Обновлено");
        hideSync();

      } catch (error) {
        alert(error.message);
      }
    };


  document.addEventListener(
    "keydown",
    event => {
      if (event.key !== "Escape") {
        return;
      }

      $("photoViewer")
        .classList.add(
          "hidden"
        );

      if (
        !$("contactModal")
          .classList
          .contains("hidden")
      ) {
        closeContactModal();
      }
    }
  );
}


/* =========================================================
   SERVICE WORKER
   ========================================================= */

function registerServiceWorker() {
  if (
    "serviceWorker" in navigator
  ) {
    navigator
      .serviceWorker
      .register(
        "./service-worker.js"
      )
      .catch(
        error =>
          console.warn(
            "Service Worker:",
            error
          )
      );
  }
}


/* =========================================================
   START
   ========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  async () => {
    bindEvents();
    registerServiceWorker();

    try {
      await DriveAPI
        .initializeGoogleAuth();

      /*
        Пытаемся войти автоматически.
        Если браузер/Google это не разрешит,
        остаётся обычная кнопка входа.
      */
      await tryAutomaticLogin();

    } catch (error) {
      console.error(error);

      $("loginStatus")
        .textContent =
        "Не удалось загрузить Google Login.";
    }
  }
);
