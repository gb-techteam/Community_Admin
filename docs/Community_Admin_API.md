# Community Admin — API Reference

**Base URL (this machine):** `http://localhost:5000`  
**Base URL (other devices on same Wi‑Fi):** `http://192.168.1.99:5000`

Backend listens on `HOST=0.0.0.0` (all interfaces). Replace the LAN IP if yours changes — check the `LAN access:` line when the server starts.

**Example endpoints from another device**

- Health: `http://192.168.1.99:5000/health`
- Login: `http://192.168.1.99:5000/api/auth/login`
- Auth header (after login): `Authorization: Bearer <token>`

**Auth header** (all routes except login / health):

```
Authorization: Bearer <token>
```

**Common error shape**

```json
{ "success": false, "message": "string" }
```

**Power keys**

`give_signals` · `create_admins` · `manage_students` · `manage_courses` · `manage_batches` · `manage_channels` · `view_channel_people` · `message_channels` · `manage_superkandle` · `manage_momentum`

**Who this API is for**

| Client | How it authenticates | Notes |
|--------|----------------------|--------|
| Admin web portal | JWT (`client: "portal"`) | This repo’s frontend |
| Admin mobile app (outside this repo) | Same JWT APIs (`client: "app"`) | Reuse `/api/auth`, `/api/channels`, messages, etc. |
| Student app | — | **Not built yet.** No student endpoints until requested. |

Signal-only accounts may log in with `client: "app"` but are blocked from `client: "portal"`.

**Notes**

- Create/delete for students, courses, batches is CRM-only (`403`).
- Powers come from the admin’s **type**, not per-admin.
- Only super admin can grant `create_admins` on a type.
- Token expires in **12 hours**.
- Powers are re-read from the database on every request, so a type change takes effect without re-login.
- Channel media files are served from `/uploads/...` on this same API host (admin web + admin app both use those URLs).

---

## 1. Auth — `/api/auth`

### `POST /api/auth/login`

**Body**

| Arg | Type | Required |
|-----|------|----------|
| `adminId` | `string` | yes |
| `password` | `string` | yes |
| `client` | `"portal"` \| `"app"` | no (default `"app"`) — use `"portal"` for the web admin, `"app"` for the admin mobile app |

**Response `200`**

```json
{
  "success": true,
  "message": "string",
  "token": "string",
  "admin": {
    "id": "string",
    "portalAdminId": "number?",
    "name": "string",
    "email": "string?",
    "role": "super_admin | portal_admin",
    "adminType": "super | staff | signal_giver",
    "adminTypeId": "number?",
    "adminTypeName": "string?",
    "isSignalOnly": "boolean?",
    "powers": ["string"]
  }
}
```

Signal-only accounts get `403` if `client` is `"portal"`.

### `GET /api/auth/me`

**Headers:** Bearer token

**Response `200`:** `{ "success": true, "admin": Admin }` — same `admin` shape as login.

---

## 2. Dashboard — `/api/dashboard`

Auth required.

### `GET /api/dashboard/stats`

**Response `200`**

```json
{
  "success": true,
  "stats": {
    "students": 0,
    "courses": 0,
    "enrollments": 0,
    "activeCourses": 0,
    "batches": 0,
    "studentsWithPhone": 0,
    "studentsWithTelegram": 0,
    "channels": 0,
    "activeChannels": 0,
    "channelMessages": 0,
    "channelMembers": 0,
    "portalAdmins": 0,
    "activePortalAdmins": 0,
    "signalGivers": 0,
    "staffAdmins": 0
  },
  "paymentBreakdown": [{ "label": "string", "count": 0 }],
  "enrollmentStatus": [{ "label": "string", "count": 0 }],
  "recentStudents": [],
  "recentEnrollments": [],
  "courseBreakdown": [],
  "recentChannels": [],
  "recentAdmins": [],
  "adminTypeBreakdown": [{ "label": "string", "count": 0 }]
}
```

---

## 3. Admin types — `/api/admin-types`

Auth + power `create_admins`.

### `GET /api/admin-types/powers`

```json
{
  "success": true,
  "powers": [{ "key": "string", "label": "string", "description": "string" }]
}
```

### `GET /api/admin-types`

```json
{
  "success": true,
  "types": [{
    "id": 1,
    "name": "string",
    "description": "string | null",
    "is_signal_only": false,
    "is_active": true,
    "created_at": "string",
    "updated_at": "string",
    "powers": ["string"],
    "admin_count": 0
  }]
}
```

### `POST /api/admin-types`

**Body**

| Arg | Type | Required |
|-----|------|----------|
| `name` | `string` | yes |
| `description` | `string` | no |
| `isSignalOnly` | `boolean` | no (default `false`) |
| `isActive` | `boolean` | no (default `true`) |
| `powers` | `string[]` | yes unless signal-only |

**Response `201`:** `{ "success": true, "type": AdminType }`

### `PUT /api/admin-types/:id`

Same body as POST. **Response `200`:** `{ "success": true, "type": AdminType }`

### `DELETE /api/admin-types/:id`

**Response `200`:** `{ "success": true, "message": "string" }`  
Fails if type has admins assigned.

---

## 4. Portal admins — `/api/portal-admins`

Auth + power `create_admins`.

### `GET /api/portal-admins/powers`

```json
{
  "success": true,
  "powers": [{ "key": "string", "label": "string", "description": "string" }]
}
```

### `GET /api/portal-admins`

```json
{
  "success": true,
  "admins": [{
    "id": 1,
    "admin_id": "string",
    "name": "string",
    "email": "string | null",
    "admin_type": "staff | signal_giver",
    "admin_type_id": 1,
    "is_active": true,
    "created_at": "string",
    "updated_at": "string",
    "type_name": "string | null",
    "is_signal_only": false,
    "powers": ["string"]
  }]
}
```

### `POST /api/portal-admins`

**Body**

| Arg | Type | Required |
|-----|------|----------|
| `adminId` | `string` | yes |
| `name` | `string` | yes |
| `password` | `string` | yes (min 6) |
| `adminTypeId` | `number` | yes |
| `email` | `string` | no |
| `isActive` | `boolean` | no (default `true`) |

**Response `201`:** `{ "success": true, "admin": PortalAdmin }`

### `PUT /api/portal-admins/:id`

Same as POST; `password` optional (omit to keep current).  
**Response `200`:** `{ "success": true, "admin": PortalAdmin }`

### `DELETE /api/portal-admins/:id`

**Response `200`:** `{ "success": true, "message": "string" }`

---

## 5. Channels — `/api/channels`

Auth + **any** of `manage_channels`, `message_channels`, `view_channel_people`.

Creating, editing, deleting channels and managing people all need `manage_channels`. Admins without it only reach channels they are a channel admin of; a request for any other channel returns `403`.

### `GET /api/channels`

**Query:** `search?: string`  
**Response:** `{ "success": true, "channels": Channel[], "canManage": true }`  

Channel includes `message_count`, `member_count`, `admin_count`, `is_mine`, **`unread_count`** (messages from others this admin has not opened yet), plus DB fields (`id`, `name`, `code`, `description`, `status`, `created_by_*`, etc.).

Channels with unread sort first. Opening `GET /api/channels/:id/messages` marks recent unread messages as seen for the current admin, which clears that channel’s badge.

### `GET /api/channels/people-search`

**Query:** `search?: string`

```json
{
  "success": true,
  "students": [{ "id": 1, "first_name": "", "last_name": "", "email": "", "phone": "" }],
  "admins": [{ "id": 1, "admin_id": "", "name": "", "email": "", "admin_type": "" }]
}
```

### `GET /api/channels/batches`

**Query:** `search?: string`

```json
{
  "success": true,
  "batches": [{ "id": 1, "name": "", "status": "", "course_title": "", "student_count": 0 }]
}
```

### `POST /api/channels`

**Body:** `{ "name": "string", "code?": "string", "description?": "string", "status?": "string" }`  
**Response `201`:** `{ "success": true, "channel": Channel }`

### `PUT /api/channels/:id`

Same body. **Response:** `{ "success": true, "channel": Channel }`

### `DELETE /api/channels/:id`

**Response:** `{ "success": true, "message": "string" }`

### `GET /api/channels/:id/members`

```json
{
  "success": true,
  "channel": {
    "id": 1,
    "name": "string",
    "created_by_role": "string",
    "created_by_admin_id": "string",
    "created_by_name": "string"
  },
  "admins": [{
    "membership_id": 1,
    "role": "string",
    "joined_at": "string",
    "portal_admin_id": 1,
    "admin_id": "string",
    "name": "string",
    "email": "string"
  }],
  "members": [{
    "membership_id": 1,
    "joined_at": "string",
    "student_id": 1,
    "first_name": "string",
    "last_name": "string",
    "email": "string",
    "phone": "string"
  }]
}
```

### `POST /api/channels/:id/members`

**Body:** `{ "studentId": 1 }`  
**Response `201`:** `{ "success": true, "member": ChannelMember }`

### `POST /api/channels/:id/members/bulk`

**Body:** `{ "studentIds?": [1], "batchIds?": [1] }`  
**Response `201`:** `{ "success": true, "added": 0, "skipped": 0, "total": 0 }`

### `POST /api/channels/:id/admins`

**Body:** `{ "portalAdminId": 1 }`  
**Response `201`:** `{ "success": true, "admin": ChannelAdmin }`

### `DELETE /api/channels/:id/members/:studentId`

**Response:** `{ "success": true, "message": "string" }`

### `DELETE /api/channels/:id/admins/:portalAdminId`

**Response:** `{ "success": true, "message": "string" }`

### `GET /api/channels/:id/messages`

Readable by anyone who can reach the channel.

**Query:** `limit?: number` (default `50`, max `100`), `before?: number` (message id — returns older messages)

**Response `200`**
```json
{
  "success": true,
  "messages": [{ "...": "Message fields", "seen_count": 0 }],
  "memberCount": 12,
  "hasMore": false,
  "canSend": true
}
```

Oldest first, ready to render as a thread. Deleted messages are never returned. `seen_count` is how many channel members have opened the message.

### `GET /api/channels/:id/messages/:messageId`

Single message detail with read receipts.

**Response `200`**
```json
{
  "success": true,
  "message": { "...": "Message + seen_count" },
  "seenBy": [{
    "student_id": 1,
    "first_name": "string",
    "last_name": "string",
    "email": "string?",
    "phone": "string?",
    "seen_at": "string"
  }],
  "seenCount": 0,
  "memberCount": 0,
  "unseenCount": 0
}
```

### `POST /api/channels/:id/messages/:messageId/seen`

docs/Community_Admin_API.md
Marks a channel member as having seen the message. Intended for the student app later; also usable by admins for testing.

**Body:** `{ "studentId": 1 }`  
Student must already be a channel member. Idempotent — first see wins for `seen_at`.

**Response:** `{ "success": true, "read": { "message_id", "student_id", "seen_at" }, "seenCount": 0 }`

Admins are tracked separately: opening `GET /messages` or message info auto-marks the current admin as seen (not on their own messages). `seenBy` lists students (`kind: "student"`) and admins (`kind: "admin"`).

Admins are tracked separately: opening `GET /messages` or message info auto-marks the current admin as seen (not for their own messages). `seenBy` includes both students (`kind: "student"`) and admins (`kind: "admin"`).

### `GET /api/channels/:id`

Single channel with counts. Same reach rules as messages.

**Response:** `{ "success": true, "channel": Channel, "canSend": true, "canManage": true }`

### `POST /api/channels/:id/messages`

Needs power `message_channels`.

Accepts JSON **or** `multipart/form-data`.

| Field | Type | Notes |
|-------|------|-------|
| `title` | string | optional headline |
| `body` | string | optional if `media` is present |
| `media` | file | optional image / video / audio |
| `mediaDurationMs` | number | optional; used for voice notes |

Supported media: JPEG/PNG/WebP/GIF, MP4/WebM/MOV, WebM/OGG/MP3/WAV/AAC audio. Max **50MB**.

Files are stored under `/uploads/channels/…` and returned as relative `media_url` values (prefix with your API host, or swap to a CDN later).

**Response `201`:** `{ "success": true, "message": Message }` — includes `media_type`, `media_url`, `media_mime`, `media_size`, `media_duration_ms`, `media_name`.

### `PUT /api/channels/:id/messages/:messageId`

Sender only, or any admin with `manage_channels`.

**Body:** `{ "title?": "string", "body": "string" }`  
**Response:** `{ "success": true, "message": Message }` — with `edited_at` set.

### `DELETE /api/channels/:id/messages/:messageId`

Sender only, or any admin with `manage_channels`. Soft delete: the row keeps its `deleted_at` stamp and disappears from every read endpoint.

**Response:** `{ "success": true, "message": "string" }`

### Realtime — WebSocket `/ws`

Same JWT as REST. Use for live channel message updates (portal + admin app).

**Connect**
```
ws://HOST:PORT/ws?token=JWT
```
Or connect without a query token, then send `{ "type": "auth", "token": "JWT" }`.

After auth the server sends `{ "type": "ready" }`.

**Subscribe to a channel**
```json
{ "type": "subscribe", "channelId": 12 }
```
Reply: `{ "type": "subscribed", "channelId": 12 }`

Access rules match message APIs (reach the channel / channel powers).

**Client → server**
| type | body |
|------|------|
| `auth` | `{ token }` |
| `subscribe` | `{ channelId }` |
| `unsubscribe` | `{ channelId }` |
| `ping` | `{}` → `{ type: "pong" }` |

**Server → subscribed clients**
| type | payload |
|------|---------|
| `message.created` | `{ channelId, message }` |
| `message.updated` | `{ channelId, message }` |
| `message.deleted` | `{ channelId, messageId }` |
| `message.seen` | `{ channelId, messageId, seenCount, read }` |

Still send/edit/delete/seen over HTTP; the socket only pushes events. Heartbeat: server `ping` frames every 30s; clients should keep the connection alive (portal sends JSON `ping` every 25s).

---

## 6. Students — `/api/students`

Auth + power `manage_students`.

| Method | Path | Args | Response |
|--------|------|------|----------|
| `GET` | `/` | Query: `search?`, `batchId?` | `{ success, students: Student[] }` |
| `PUT` | `/:id` | Body: `firstName`, `lastName?`, `email`, `phone?`, `address?`, `dateOfBirth?`, `telegramUser?` | `{ success, student }` |
| `POST` | `/` | — | `403` CRM only |
| `DELETE` | `/:id` | — | `403` CRM only |

**Student list fields:** `id`, `first_name`, `last_name`, `email`, `phone`, `address`, `date_of_birth`, `telegram_user`, `created_at`, `updated_at`, `course_count`, `batch_names`, `batch_ids`

---

## 7. Courses — `/api/courses`

Auth; list needs `manage_courses` **or** `manage_batches`; update needs `manage_courses`.

| Method | Path | Args | Response |
|--------|------|------|----------|
| `GET` | `/` | Query: `search?` | `{ success, courses: Course[] }` |
| `PUT` | `/:id` | Body: `title`, `description?`, `duration?`, `price?`, `status?` | `{ success, course }` |
| `POST` / `DELETE` | | | `403` CRM only |

---

## 8. Batches — `/api/batches`

Auth; list needs `manage_batches` **or** `manage_students`.

| Method | Path | Args | Response |
|--------|------|------|----------|
| `GET` | `/` | — | `{ success, batches: Batch[] }` |
| `GET` | `/members` | Query: `batchId?`, `search?` (needs `manage_batches`) | `{ success, members: BatchMember[] }` |
| `PUT` | `/:id` | Body: `name`, `courseId?`, `startDate?`, `endDate?`, `status?`, `isOpen?` | `{ success, batch }` |
| `POST` / `DELETE` | | | `403` CRM only |

---

## 9. Misc

| Method | Path | Auth | Response |
|--------|------|------|----------|
| `GET` | `/health` | no | `{ "status": "ok" }` |
| `GET` | `/db-check` | no | `{ "connected": true, "now?": "string" }` |
| `GET` | `/uploads/...` | no | Static channel media files (images, videos, voice) |

---

## 10. Student app — deferred
No student-facing API is exposed yet. When the student app is started, new endpoints can be added under a separate prefix (for example `/api/student`) without changing the admin JWT APIs used by the web portal and admin mobile app.
