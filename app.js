/* =========================================================
   PersonalCRM
   Основная логика приложения
   ========================================================= */

let database = null;
let currentContactId = null;
let editingContactId = null;

let photoUrls = new Map();
let viewerPhotos = [];
let viewerPhotoIndex = 0;


/* =========================================================
   ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
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
  ]
    .filter(Boolean)
    .join(" ");
}


function shortName(contact) {
  return [
    contact.firstName,
    contact.lastName
  ]
    .filter(Boolean)
    .join(" ");
}


function getContact(id) {
  return database.contacts.find(
    contact => contact.id === id
  );
}


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

  if (
    contact.birthDate ||
    contact.deathDate
  ) {
    parts.push(
      `${contact.birthDate || "?"} — ${contact.deathDate || ""}`
    );
  }

  const age = calculateAge(contact);

  if (
    age !== "" &&
    !contact.deathDate
  ) {
    parts.push(`${age} лет`);
  }

  return parts.join(" · ");
}


function showSync(text) {
  const el = $("syncStatus");

  el.textContent = text;
  el.classList.remove("hidden");
}


function hideSync(delay = 500) {
  setTimeout(() => {
    $("syncStatus").classList.add("hidden");
  }, delay);
}


async function persistDatabase() {
  showSync("Сохранение...");

  try {
    await DriveAPI.saveDatabase(database);
    showSync("Сохранено");
    hideSync(800);
  } catch (error) {
    console.error(error);
    showSync("Ошибка сохранения");
    alert(error.message);
  }
}


/* =========================================================
   НАВИГАЦИЯ
   ========================================================= */

function showPage(pageName) {
  document
    .querySelectorAll(".page")
    .forEach(page =>
      page.classList.remove("active")
    );

  const map = {
    contacts: "contactsPage",
    contact: "contactPage",
    family: "familyPage",
    trash: "trashPage"
  };

  $(map[pageName])
    ?.classList.add("active");

  document
    .querySelectorAll(
      ".nav-btn, .mobile-nav-btn"
    )
    .forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.page === pageName
      );
    });

  window.scrollTo(0, 0);
}


/* =========================================================
   КОНТАКТЫ
   ========================================================= */

function renderContacts() {
  const list =
    $("contactsList");

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
        .map(x => x.value),
      ...(contact.personalData || [])
        .map(x => x.value)
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return searchable.includes(search);
  });

  contacts.sort((a, b) => {
    const last =
      safe(a.lastName).localeCompare(
        safe(b.lastName),
        "ru"
      );

    if (last !== 0) return last;

    return safe(a.firstName)
      .localeCompare(
        safe(b.firstName),
        "ru"
      );
  });

  $("contactsCount").textContent =
    `${contacts.length} контактов`;

  $("emptyContacts")
    .classList.toggle(
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

    const photo =
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

      photo.appendChild(img);

    } else {
      photo.className =
        "contact-list-photo-placeholder";

      photo.textContent =
        initials(contact);
    }

    const main =
      document.createElement("div");

    main.className =
      "contact-list-main";

    const name =
      document.createElement("div");

    name.className =
      "contact-list-name";

    name.textContent =
      shortName(contact) ||
      "Без имени";

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

    item.append(
      photo,
      main
    );

    list.appendChild(item);
  });

  renderCategoryFilter();
}


function initials(contact) {
  return (
    safe(contact.firstName)
      .charAt(0) +
    safe(contact.lastName)
      .charAt(0)
  ).toUpperCase() || "?";
}


function renderCategoryFilter() {
  const select =
    $("categoryFilter");

  const current =
    select.value;

  const categories =
    [
      ...new Set(
        database.contacts
          .map(c => c.category)
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

    option.value =
      category;

    option.textContent =
      category;

    select.appendChild(option);
  });

  select.value =
    categories.includes(current)
      ? current
      : "";
}


/* =========================================================
   ПРОСМОТР КОНТАКТА
   ========================================================= */

async function openContact(id) {
  const contact =
    getContact(id);

  if (!contact) return;

  currentContactId =
    id;

  showPage("contact");

  $("profileName").textContent =
    fullName(contact) ||
    "Без имени";

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
  renderPhotos(contact);
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
    placeholder.classList.remove("hidden");
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


function renderBasicInfo(contact) {
  const rows = [
    ["Имя", contact.firstName],
    ["Фамилия", contact.lastName],
    ["Отчество / другие имена", contact.middleName],
    ["Пол", genderLabel(contact.gender)],
    ["Дата рождения", contact.birthDate],
    ["Дата смерти", contact.deathDate],
    ["Место рождения", contact.birthPlace],
    ["Место смерти", contact.deathPlace]
  ];

  renderSimpleRows(
    $("basicInfo"),
    rows
  );
}


function genderLabel(value) {
  if (value === "male") {
    return "Мужской";
  }

  if (value === "female") {
    return "Женский";
  }

  if (value === "unknown") {
    return "Неизвестно";
  }

  return "";
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
    .forEach(
      ([label, value]) => {

        const row =
          document.createElement("div");

        row.className =
          "data-row";

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
      }
    );
}


function renderDatedRows(
  container,
  rows
) {
  container.innerHTML = "";

  (rows || [])
    .forEach(item => {
      const row =
        document.createElement("div");

      row.className =
        "data-row";

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

  (contact.notes || [])
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
   СВЯЗИ
   ========================================================= */

function renderRelations(contact) {
  const container =
    $("relationsList");

  container.innerHTML = "";

  (contact.relations || [])
    .forEach(relation => {

      const target =
        getContact(
          relation.contactId
        );

      if (!target) return;

      const row =
        document.createElement("div");

      row.className =
        "relation-item";

      const type =
        document.createElement("div");

      type.className =
        "relation-type";

      type.textContent =
        relationLabel(
          relation.type
        );

      const link =
        document.createElement("a");

      link.href = "#";
      link.className =
        "relation-link";

      link.textContent =
        shortName(target);

      link.addEventListener(
        "click",
        event => {
          event.preventDefault();

          openContact(
            target.id
          );
        }
      );

      row.append(
        type,
        link
      );

      container.appendChild(row);
    });
}


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


function removeReverseRelations(
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


function createReverseRelations(
  source
) {
  source.relations ||= [];

  source.relations.forEach(
    relation => {

      const target =
        getContact(
          relation.contactId
        );

      if (!target) return;

      target.relations ||= [];

      const reverseType =
        reverseRelationType(
          relation.type,
          source.gender
        );

      const exists =
        target.relations.some(
          r =>
            r.contactId === source.id &&
            r.autoSourceId === source.id
        );

      if (!exists) {
        target.relations.push({
          id: uuid(),
          type: reverseType,
          contactId: source.id,
          auto: true,
          autoSourceId: source.id
        });
      }
    }
  );
}


/* =========================================================
   ФОТО
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

    photoUrls.set(
      fileId,
      url
    );

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

      wrapper.style.position =
        "relative";

      const item =
        document.createElement("div");

      item.className =
        "photo-item";

      const img =
        document.createElement("img");

      img.alt =
        photo.name || "Фото";

      loadPhotoIntoImage(
        img,
        photo.fileId
      );

      item.appendChild(img);

      item.addEventListener(
        "click",
        () => openPhotoViewer(
          contact,
          index
        )
      );

      const controls =
        document.createElement("div");

      controls.style.display =
        "flex";

      controls.style.gap =
        "5px";

      controls.style.marginTop =
        "5px";

      const profileButton =
        document.createElement("button");

      profileButton.className =
        "secondary-btn";

      profileButton.style.flex = "1";

      profileButton.style.fontSize =
        "12px";

      profileButton.textContent =
        contact.profilePhotoId ===
        photo.fileId
          ? "Профильное"
          : "На профиль";

      profileButton.addEventListener(
        "click",
        async event => {
          event.stopPropagation();

          contact.profilePhotoId =
            photo.fileId;

          await persistDatabase();

          openContact(
            contact.id
          );

          renderContacts();
        }
      );

      const removeButton =
        document.createElement("button");

      removeButton.className =
        "danger-btn";

      removeButton.style.fontSize =
        "12px";

      removeButton.textContent =
        "Удалить";

      removeButton.addEventListener(
        "click",
        async event => {

          event.stopPropagation();

          if (
            !confirm(
              "Удалить эту фотографию?"
            )
          ) {
            return;
          }

          try {
            await DriveAPI
              .deleteDriveFile(
                photo.fileId
              );

            photoUrls.delete(
              photo.fileId
            );

            contact.photos =
              contact.photos.filter(
                p =>
                  p.fileId !==
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

            openContact(contact.id);
            renderContacts();

          } catch (error) {
            alert(error.message);
          }
        }
      );

      controls.append(
        profileButton,
        removeButton
      );

      wrapper.append(
        item,
        controls
      );

      gallery.appendChild(
        wrapper
      );
    }
  );
}


async function uploadSelectedPhotos(
  files
) {
  const contact =
    getContact(
      currentContactId
    );

  if (!contact) return;

  if (!files.length) return;

  showSync(
    "Загрузка фотографий..."
  );

  try {
    const folderId =
      await DriveAPI
        .getOrCreateContactPhotoFolder(
          contact.id
        );

    contact.photos ||= [];

    for (const file of files) {

      const uploaded =
        await DriveAPI.uploadPhoto(
          file,
          folderId
        );

      contact.photos.push({
        id: uuid(),
        fileId:
          uploaded.id,
        name:
          uploaded.name,
        mimeType:
          uploaded.mimeType ||
          file.type,
        createdAt:
          uploaded.createdTime ||
          new Date().toISOString()
      });

      if (!contact.profilePhotoId) {
        contact.profilePhotoId =
          uploaded.id;
      }
    }

    await persistDatabase();

    await openContact(
      contact.id
    );

    renderContacts();

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
   ФОРМА КОНТАКТА
   ========================================================= */

function openContactForm(
  contactId = null
) {
  editingContactId =
    contactId;

  const contact =
    contactId
      ? getContact(contactId)
      : createBlankContact();

  $("contactModalTitle")
    .textContent =
    contactId
      ? "Редактировать контакт"
      : "Новый контакт";

  $("contactFormContent")
    .innerHTML =
    buildContactForm(contact);

  bindDynamicFormButtons();

  $("contactModal")
    .classList
    .remove("hidden");
}


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


function buildContactForm(
  contact
) {
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
          (contact.tags || []).join(", ")
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
          .filter(r => !r.auto)
          .map(r =>
            relationRow(
              r,
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
   ДИНАМИЧЕСКИЕ ПОЛЯ
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
        data-section="${name}"
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
  const presetList =
    presets.length
      ? `
        <datalist id="list-${uuid()}">
          ${presets
            .map(
              p =>
                `<option value="${escapeHtml(p)}">`
            )
            .join("")}
        </datalist>
      `
      : "";

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
            p =>
              `<option value="${escapeHtml(p)}"></option>`
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


function noteRow(
  note = {}
) {
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
  const options =
    database.contacts
      .filter(
        c => c.id !== currentId
      )
      .sort(
        (a, b) =>
          fullName(a)
            .localeCompare(
              fullName(b),
              "ru"
            )
      )
      .map(
        contact => `
          <option
            value="${contact.id}"
            ${relation.contactId === contact.id ? "selected" : ""}
          >
            ${escapeHtml(
              shortName(contact)
            )}
          </option>
        `
      )
      .join("");

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

        ${options}
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
      button.onclick =
        () => {
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
          dynamicRow(
            {},
            presets
          )
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

      const currentId =
        addRelation.dataset
          .currentContact;

      $("relationsRows")
        .insertAdjacentHTML(
          "beforeend",
          relationRow(
            {},
            currentId
          )
        );

      bindDynamicFormButtons();
    };
  }
}


/* =========================================================
   ЧТЕНИЕ ФОРМЫ
   ========================================================= */

function readDynamicRows(
  containerId
) {
  return [
    ...$(containerId)
      .querySelectorAll(
        ".dynamic-row"
      )
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
      .querySelectorAll(
        ".dynamic-row"
      )
  ]
    .map(row => ({
      id: uuid(),

      text:
        row.querySelector(
          ".note-text-input"
        )
          ?.value.trim() || "",

      date:
        row.querySelector(
          ".note-date-input"
        )
          ?.value.trim() || ""
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
        ).value
    }))
    .filter(
      relation =>
        relation.contactId
    );
}


/* =========================================================
   СОХРАНЕНИЕ КОНТАКТА
   ========================================================= */

async function saveContactForm(
  event
) {
  event.preventDefault();

  const form =
    new FormData(
      $("contactForm")
    );

  let contact =
    editingContactId
      ? getContact(
          editingContactId
        )
      : createBlankContact();

  if (!contact) return;

  removeReverseRelations(
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

  createReverseRelations(
    contact
  );

  await persistDatabase();

  closeContactModal();

  renderContacts();

  await openContact(
    contact.id
  );
}


/* =========================================================
   УДАЛЕНИЕ / КОРЗИНА
   ========================================================= */

async function moveContactToTrash(
  id
) {
  const index =
    database.contacts.findIndex(
      contact =>
        contact.id === id
    );

  if (index === -1) return;

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

  database.trash.push(
    contact
  );

  database.contacts.forEach(
    c => {
      c.relations =
        (c.relations || [])
          .filter(
            relation =>
              relation.contactId !== id
          );
    }
  );

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

  database.trash
    .forEach(contact => {

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

  if (index === -1) return;

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


async function permanentlyDeleteContact(
  id
) {
  const contact =
    database.trash.find(
      c => c.id === id
    );

  if (!contact) return;

  if (
    !confirm(
      `Окончательно удалить "${shortName(contact)}"? Отменить это будет невозможно.`
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

  database.trash =
    database.trash.filter(
      c => c.id !== id
    );

  await persistDatabase();

  renderTrash();
}


/* =========================================================
   СЕМЕЙНОЕ ДЕРЕВО
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

  select.value = current;
}


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

  const root =
    getContact(rootId);

  if (!root) return;


  const ancestors =
    buildAncestorTree(
      root,
      new Set()
    );

  const descendants =
    buildDescendantTree(
      root,
      new Set()
    );


  const layout =
    document.createElement("div");

  layout.style.display =
    "grid";

  layout.style.gridTemplateColumns =
    "1fr auto 1fr";

  layout.style.gap =
    "30px";

  layout.style.minWidth =
    "750px";

  layout.style.alignItems =
    "center";


  const left =
    document.createElement("div");

  left.style.display =
    "flex";

  left.style.justifyContent =
    "flex-end";

  left.appendChild(
    ancestors
  );


  const center =
    document.createElement("div");

  center.appendChild(
    createFamilyNode(root)
  );


  const right =
    document.createElement("div");

  right.appendChild(
    descendants
  );


  layout.append(
    left,
    center,
    right
  );

  container.appendChild(
    layout
  );
}


function buildAncestorTree(
  contact,
  visited
) {
  const wrapper =
    document.createElement("div");

  if (visited.has(contact.id)) {
    return wrapper;
  }

  visited.add(contact.id);

  const parents =
    getRelationsByTypes(
      contact,
      ["father", "mother"]
    );

  if (!parents.length) {
    return wrapper;
  }

  wrapper.style.display =
    "flex";

  wrapper.style.flexDirection =
    "column";

  wrapper.style.gap =
    "14px";

  parents.forEach(parent => {

    const row =
      document.createElement("div");

    row.style.display =
      "flex";

    row.style.alignItems =
      "center";

    row.style.justifyContent =
      "flex-end";

    row.style.gap =
      "10px";

    const older =
      buildAncestorTree(
        parent,
        new Set(visited)
      );

    row.append(
      older,
      createFamilyNode(parent)
    );

    wrapper.appendChild(
      row
    );
  });

  return wrapper;
}


function buildDescendantTree(
  contact,
  visited
) {
  const wrapper =
    document.createElement("div");

  if (visited.has(contact.id)) {
    return wrapper;
  }

  visited.add(contact.id);

  const children =
    getRelationsByTypes(
      contact,
      ["son", "daughter"]
    );

  if (!children.length) {
    return wrapper;
  }

  wrapper.style.display =
    "flex";

  wrapper.style.flexDirection =
    "column";

  wrapper.style.gap =
    "14px";

  children.forEach(child => {

    const row =
      document.createElement("div");

    row.style.display =
      "flex";

    row.style.alignItems =
      "center";

    row.style.gap =
      "10px";

    row.append(
      createFamilyNode(child),
      buildDescendantTree(
        child,
        new Set(visited)
      )
    );

    wrapper.appendChild(
      row
    );
  });

  return wrapper;
}


function getRelationsByTypes(
  contact,
  types
) {
  return (contact.relations || [])
    .filter(
      relation =>
        types.includes(
          relation.type
        )
    )
    .map(
      relation =>
        getContact(
          relation.contactId
        )
    )
    .filter(Boolean);
}


function createFamilyNode(
  contact
) {
  const node =
    document.createElement("div");

  node.className =
    "family-node";

  if (contact.profilePhotoId) {

    const img =
      document.createElement("img");

    img.className =
      "family-node-photo";

    loadPhotoIntoImage(
      img,
      contact.profilePhotoId
    );

    node.appendChild(img);
  }

  const name =
    document.createElement("div");

  name.className =
    "family-node-name";

  name.textContent =
    shortName(contact);

  const life =
    document.createElement("div");

  life.className =
    "contact-list-meta";

  life.textContent =
    lifeText(contact);

  node.append(
    name,
    life
  );

  node.onclick =
    () =>
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

  editingContactId = null;
}


/* =========================================================
   СОБЫТИЯ
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
    .addEventListener(
      "click",
      () => {
        renderContacts();
        showPage("contacts");
      }
    );


  document
    .querySelectorAll(
      "[data-page]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const page =
            button.dataset.page;

          if (
            page ===
            "contacts"
          ) {
            renderContacts();
          }

          if (
            page ===
            "family"
          ) {
            renderFamilyRootSelect();
            renderFamilyTree();
          }

          showPage(page);
        }
      );
    });


  $("addContactBtn")
    .addEventListener(
      "click",
      () =>
        openContactForm()
    );


  $("mobileAddContactBtn")
    .addEventListener(
      "click",
      () =>
        openContactForm()
    );


  $("editContactBtn")
    .addEventListener(
      "click",
      () => {
        if (currentContactId) {
          openContactForm(
            currentContactId
          );
        }
      }
    );


  $("deleteContactBtn")
    .addEventListener(
      "click",
      () => {
        if (currentContactId) {
          moveContactToTrash(
            currentContactId
          );
        }
      }
    );


  $("backToContactsBtn")
    .addEventListener(
      "click",
      () => {
        renderContacts();
        showPage("contacts");
      }
    );


  $("trashBtn")
    .addEventListener(
      "click",
      () => {
        renderTrash();
        showPage("trash");
      }
    );


  $("backFromTrashBtn")
    .addEventListener(
      "click",
      () => {
        renderContacts();
        showPage("contacts");
      }
    );


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
    .addEventListener(
      "click",
      closeContactModal
    );


  $("cancelContactBtn")
    .addEventListener(
      "click",
      closeContactModal
    );


  $("contactModal")
    .querySelector(
      ".modal-backdrop"
    )
    .addEventListener(
      "click",
      closeContactModal
    );


  $("contactForm")
    .addEventListener(
      "submit",
      saveContactForm
    );


  $("addPhotoBtn")
    .addEventListener(
      "click",
      () =>
        $("photoInput")
          .click()
    );


  $("photoInput")
    .addEventListener(
      "change",
      event =>
        uploadSelectedPhotos(
          [...event.target.files]
        )
    );


  $("closePhotoViewerBtn")
    .addEventListener(
      "click",
      () =>
        $("photoViewer")
          .classList.add(
            "hidden"
          )
    );


  $("previousPhotoBtn")
    .addEventListener(
      "click",
      async () => {

        viewerPhotoIndex =
          (
            viewerPhotoIndex -
            1 +
            viewerPhotos.length
          ) %
          viewerPhotos.length;

        await renderViewerPhoto();
      }
    );


  $("nextPhotoBtn")
    .addEventListener(
      "click",
      async () => {

        viewerPhotoIndex =
          (
            viewerPhotoIndex +
            1
          ) %
          viewerPhotos.length;

        await renderViewerPhoto();
      }
    );


  $("familyRootSelect")
    .addEventListener(
      "change",
      async () => {

        database.settings
          .familyRootId =
          $("familyRootSelect")
            .value || null;

        await persistDatabase();

        renderFamilyTree();
      }
    );


  document
    .addEventListener(
      "keydown",
      event => {

        if (event.key === "Escape") {

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
      }
    );
}


/* =========================================================
   LOGIN
   ========================================================= */

async function login() {
  $("loginStatus")
    .textContent =
    "Подключение к Google Drive...";

  try {
    await DriveAPI
      .loginWithGoogle();

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

  } catch (error) {
    console.error(error);

    $("loginStatus")
      .textContent =
      error.message ||
      "Ошибка входа.";
  }
}


/* =========================================================
   НОРМАЛИЗАЦИЯ БАЗЫ
   ========================================================= */

function normalizeDatabase() {
  database.contacts ||= [];
  database.trash ||= [];

  database.settings ||= {
    familyRootId: null
  };

  database.contacts
    .forEach(contact => {

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

    } catch (error) {
      console.error(error);

      $("loginStatus")
        .textContent =
        "Не удалось загрузить Google Login.";
    }
  }
);
