# VoxAgent — Business Requirements Document

**Version:** 1.0  
**Date:** August 12, 2026  
**Status:** Final  
**Prepared by:** VoxAgent Product Team

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Vision & Goals](#2-product-vision--goals)
3. [Stakeholders](#3-stakeholders)
4. [System Architecture Overview](#4-system-architecture-overview)
5. [Feature Areas](#5-feature-areas)
   - 5.1 [Persona Engine](#51-persona-engine)
   - 5.2 [Call Management](#52-call-management)
   - 5.3 [Bot Network](#53-bot-network)
   - 5.4 [Analytics Dashboard](#54-analytics-dashboard)
   - 5.5 [Configuration & LLM Engine](#55-configuration--llm-engine)
   - 5.6 [Knowledge Base & Memory](#56-knowledge-base--memory)
   - 5.7 [Flow Builder](#57-flow-builder)
   - 5.8 [Email Agent](#58-email-agent)
   - 5.9 [Messaging Hub](#59-messaging-hub)
   - 5.10 [Calendar & Scheduling](#510-calendar--scheduling)
   - 5.11 [Mobile Application](#511-mobile-application)
6. [Data Model Summary](#6-data-model-summary)
7. [API Surface](#7-api-surface)
8. [Non-Functional Requirements](#8-non-functional-requirements)
9. [Constraints & Assumptions](#9-constraints--assumptions)
10. [Glossary](#10-glossary)

---

## 1. Executive Summary

VoxAgent is an enterprise AI voice-bot control plane that enables organisations to deploy, configure, monitor, and continuously improve AI-powered telephone agents. The platform allows operators to:

- Define rich voice-bot personas backed by structured trait data and AI-generated system prompts.
- Initiate and receive telephone calls through a managed bot fleet.
- Monitor call analytics, transcripts, recordings, and intelligence metrics in real time.
- Orchestrate post-call workflows including email summaries, calendar invites, and CRM disposition.
- Control the entire system from a web dashboard or a companion mobile application.

VoxAgent is delivered as a monorepo consisting of an Express API server, a React/Vite web dashboard, an Expo React Native mobile app, and shared TypeScript libraries for the database schema, API client, and Zod validation schemas.

---

## 2. Product Vision & Goals

### Vision
Give any organisation the ability to deploy a human-quality AI telephone agent in hours — not months — and continuously refine it without engineering support.

### Primary Goals

| # | Goal | Measure of Success |
|---|------|-------------------|
| G1 | Reduce time-to-deploy a new voice persona | < 30 min from first login to first live call |
| G2 | Ensure system-prompt integrity across persona edits | Composed prompt snapshotted on every call record |
| G3 | Block misconfigured personas from reaching customers | Activate endpoint enforces identity-field validation (HTTP 422 on failure) |
| G4 | Give operators full call intelligence on every interaction | AMD rate, language mix, barge-in, escalation, transcript available per call |
| G5 | Enable monitoring from a mobile device | Full call detail, filters, and recordings accessible on iOS/Android |
| G6 | Support post-call operational workflows | Summary emails, calendar invites, and CRM disposition sent automatically |

---

## 3. Stakeholders

| Role | Responsibility |
|------|----------------|
| **Contact Centre Manager** | Configures bots, personas, and calling hours; reviews analytics |
| **AI/Prompt Engineer** | Authors and refines persona traits; uses AI regenerate and refine flows |
| **Operations Supervisor** | Monitors live and historical calls; dispatches transfers; reviews recordings |
| **Mobile Field Operator** | Reviews call activity and transcripts on the companion mobile app |
| **IT Administrator** | Manages API keys, LLM provider config, SIP/WhatsApp integration credentials |
| **VoxAgent Platform Team** | Develops and maintains the product |

---

## 4. System Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Client Layer                         │
│  React/Vite Dashboard          Expo Mobile App          │
│  (artifacts/dashboard)         (artifacts/mobile)       │
└───────────────────┬─────────────────────┬───────────────┘
                    │  REST + JSON         │
┌───────────────────▼─────────────────────▼───────────────┐
│                 API Server (Express 5)                   │
│              (artifacts/api-server)                      │
│                                                         │
│  Routes: calls · personas · bots · stats · config       │
│           memory · flow · email-agent · messaging        │
│           calendar · api-keys · health                   │
│                                                         │
│  Services: PersonaComposer · PersonaService             │
│            CallConnectService · Logger                   │
└───────────────────────────┬─────────────────────────────┘
                            │  Drizzle ORM
┌───────────────────────────▼─────────────────────────────┐
│                  PostgreSQL Database                     │
│  Tables: calls · bots · personas · persona_traits       │
│          persona_config · conversation_config · llm_config│
│          flow_configs · memory_entries · message_logs   │
│          calendar_invites · email_agent_config          │
│          writing_style_profiles                         │
└─────────────────────────────────────────────────────────┘
```

### Shared Libraries

| Package | Purpose |
|---------|---------|
| `@workspace/db` | Drizzle schema, migration runner, typed table exports |
| `@workspace/api-zod` | Zod schemas for all request/response shapes |
| `@workspace/api-client-react` | React Query hooks generated from the OpenAPI spec |

---

## 5. Feature Areas

### 5.1 Persona Engine

#### Overview
The Persona Engine is the core differentiation of VoxAgent. It allows operators to create named, versioned AI personas — each backed by structured trait data — and have those traits automatically translated into a voice-bot system prompt by the PersonaComposer service.

#### Requirements

**Persona Lifecycle**

| ID | Requirement |
|----|-------------|
| PE-01 | The system shall maintain a library of named personas, each with a unique name, description, source badge (Manual / Library / AI-Generated), version counter, and active flag. |
| PE-02 | At most one persona may be active at a time. Activating a persona deactivates all others atomically. |
| PE-03 | Activating a persona with empty `role_title`, `backstory`, or `goals` fields shall be rejected with HTTP 422 and a human-readable error message. |
| PE-04 | Personas may be duplicated; duplicates are assigned a new unique name and version 1. |
| PE-05 | Personas may be soft-deleted. Call records that reference a deleted persona shall display a "Deleted persona" label rather than a blank. |
| PE-06 | Five pre-seeded library personas shall be available at first launch (Hotel Receptionist, Hospital Appointment Desk, Bank Customer Care, E-commerce Order Support, Debt Collection Agent). |

**Trait Structure**

Persona traits are organised into five sections:

| Section | Fields |
|---------|--------|
| **Identity** | role_title, character, backstory, goals |
| **Language** | jargon (tags), greeting phrases, closing phrases, forbidden phrases, sample utterances |
| **Tone** | formality (1–10), verbosity (1–10), empathy (1–10), humor (1–10) |
| **Voice** | speaking pace, pitch, Deepgram voice hint, gender |
| **Behavior** | interrupt tolerance, silence strategy, escalation trigger, do-rules (tags), don't-rules (tags) |

| ID | Requirement |
|----|-------------|
| PE-07 | The trait editor shall provide sliders for all numeric tone fields (range 1–10). |
| PE-08 | Jargon, greeting/closing/forbidden phrases, rules, and sample utterances shall use a tag-style editor supporting add and remove operations. |
| PE-09 | Pace, pitch, interrupt tolerance, and silence strategy shall use dropdown selectors. |
| PE-10 | The editor shall track an unsaved-changes ("dirty") state, show a yellow indicator on the Edit Traits tab, display a browser `beforeunload` warning if the user closes the tab with unsaved changes, and show a confirm dialog before navigating away in-app. |

**AI-Powered Authoring**

| ID | Requirement |
|----|-------------|
| PE-11 | The "Generate Traits" flow shall accept a persona name and optional description, call the configured LLM with a 30-second timeout, and return a fully populated trait object. |
| PE-12 | The "Refine with AI" flow shall accept the current trait JSON and a plain-English instruction, call the LLM, and return updated traits for side-by-side diff review before the operator confirms the save. |
| PE-13 | LLM calls shall use the primary LLM engine with fallback to the configured fallback chain. All trait generation calls shall be logged with success/failure status. |
| PE-14 | If an LLM call exceeds 30 seconds or fails, a visible Retry button shall appear; the UI shall never display an infinite spinner. |

**Persona Test Chat**

| ID | Requirement |
|----|-------------|
| PE-15 | The Test Persona panel shall run 3–4 sample dialogue exchanges using the composed system prompt and display bot responses inline. |
| PE-16 | The composed system prompt (the full text the voice bot receives) shall be visible in the Test Persona panel. |

**PersonaComposer Service**

| ID | Requirement |
|----|-------------|
| PE-17 | The PersonaComposer service shall translate numeric tone values and all trait fields into structured, natural-language guidance sections (identity, language, tone, behavior, escalation). |
| PE-18 | The service shall export `validatePersonaForVoiceBot(traits)` returning `{ valid: boolean, issues: string[] }`. This function shall be called before activation and before inbound call stamping. |
| PE-19 | The composed prompt, persona ID, and persona name shall be snapshotted onto the call record at dial time and stored immutably — subsequent trait edits shall not alter the snapshot. |

---

### 5.2 Call Management

#### Overview
VoxAgent manages the full lifecycle of outbound and inbound telephone calls, persisting intelligence data on every interaction.

#### Requirements

**Call Record Schema**

Every call record contains:

| Field | Description |
|-------|-------------|
| `direction` | INBOUND or OUTBOUND |
| `status` | RINGING · IN_PROGRESS · COMPLETED · FAILED |
| `customerNumber` | E.164 phone number |
| `customerName` | Optional display name |
| `botId` | Originating/receiving bot |
| `personaId` | Persona active at call start |
| `composedPrompt` | Full system prompt snapshot |
| `connectOutcome` | AMD result: HUMAN · VOICEMAIL · IVR · NO_ANSWER |
| `languageDetected` | BCP-47 code |
| `duration` | Seconds |
| `hangupReason` | Who ended the call |
| `finalDisposition` | CRM outcome |
| `interruptionCount` | Customer barge-in events |
| `escalationCount` | Times escalation rule fired |
| `languageSwitches` | JSON array of switch events |
| `transcript` | Full turn-by-turn transcript |
| `summary` | AI-generated call summary |
| `recordingUrl` | URL of call recording |

**Outbound Calls**

| ID | Requirement |
|----|-------------|
| CL-01 | Operators shall initiate outbound calls by supplying a destination E.164 number and selecting a bot. |
| CL-02 | The active persona's traits shall be validated before dialling; invalid personas shall be rejected with an error shown in the UI. |
| CL-03 | AMD classification (Human / Voicemail / IVR / No Answer) shall be performed and stored on every outbound call. |
| CL-04 | Calling-hours rules configured on the bot shall be enforced; calls outside permitted hours shall be rejected. |

**Inbound Calls**

| ID | Requirement |
|----|-------------|
| CL-05 | The `POST /v1/calls/receive` webhook endpoint shall accept inbound telephony callbacks and create an INBOUND call record. |
| CL-06 | If an active persona exists and passes `validatePersonaForVoiceBot`, its ID and composed prompt shall be stamped onto the call record. |
| CL-07 | If no valid active persona exists, the call shall still be recorded; a warning shall be logged and the persona fields left null. |

**Call Operations**

| ID | Requirement |
|----|-------------|
| CL-08 | Operators shall be able to transfer a call to a specified destination from the Call Log. |
| CL-09 | Operators shall be able to initiate a conference on an active call. |
| CL-10 | Call records shall be deletable by administrators. |

**Call Log UI**

| ID | Requirement |
|----|-------------|
| CL-11 | The Call Log shall display direction, phone number, status badge, connect outcome, duration, disposition, language, persona name, and start time for each call. |
| CL-12 | Calls with status RINGING or IN_PROGRESS shall display a pulsing animated live indicator inside their status badge. |
| CL-13 | The persona name column shall show the persona name as snapshotted at call time. Calls made before persona stamping was introduced, and calls where no persona was active, shall display "—". Calls that used a since-deleted persona shall display "Deleted persona" with a muted label style. |
| CL-14 | Clicking a call row shall open a detail panel showing all call intelligence fields, transcript/summary, and a recording link. |
| CL-15 | The Call Log shall support filtering by direction (All / Inbound / Outbound) and status (All / Active / Completed / Failed) and refreshing on demand. |

---

### 5.3 Bot Network

#### Overview
The Bot Network module manages the fleet of voice-bot instances. Each bot is a configured telephony endpoint that can handle calls in one or both directions.

#### Requirements

| ID | Requirement |
|----|-------------|
| BN-01 | Each bot shall have a display name, direction (INBOUND / OUTBOUND / BOTH), SIP extension/domain, email address, and WhatsApp number. |
| BN-02 | Bots shall store supported languages and a default greeting language. |
| BN-03 | Bots shall store calling-hours rules (timezone, permitted windows) enforced at dial time. |
| BN-04 | Per-bot configuration shall include: answer delay (ms), barge-in threshold (ms), silence recovery (seconds), backchannel threshold (ms), AMD opening script, greeting script, max retries. |
| BN-05 | Per-bot escalation configuration shall include: escalation queue target and conversation-intelligence controls (escalation trigger sensitivity). |
| BN-06 | The Bot Network UI shall display each bot's status (ONLINE / OFFLINE / BUSY), active call count, and all configuration fields. |
| BN-07 | Operators shall be able to create, edit, and delete bots from the dashboard. |

---

### 5.4 Analytics Dashboard

#### Overview
The Analytics Dashboard provides a real-time overview of the voice-bot operation through KPI cards and interactive charts.

#### Requirements

**KPI Cards**

| ID | Requirement |
|----|-------------|
| DB-01 | The dashboard header shall display: Total Calls, Active Now, Completed Today, Success Rate (%), Average Duration, AMD Accuracy (%), Memory Hit Rate (%), and Bots Online count. |

**Charts**

| ID | Chart | Requirement |
|----|-------|-------------|
| DB-02 | Call Volume (24 h) | Hourly bar chart of call volume for the last 24 hours; bars coloured by direction. |
| DB-03 | Hangup Reasons | Horizontal bar chart showing the distribution of `hangupReason` values across all calls. |
| DB-04 | Connect Outcomes | Horizontal bar chart of AMD classification results (Human / Voicemail / IVR / No Answer). |
| DB-05 | Language Mix | Pie chart showing the percentage breakdown of `languageDetected` values across all calls. |
| DB-06 | Call Intelligence | Stat list showing: average interruptions per call, average escalations per call, barge-in rate (%), average language switches per call; computed across all stored call records. |

**Data Freshness**

| ID | Requirement |
|----|-------------|
| DB-07 | All dashboard data shall be fetched on mount and on manual Refresh. Polling is not required. |
| DB-08 | Charts with no data (e.g. Connect Outcomes before any AMD calls are made) shall display a "No data yet" placeholder rather than a blank or broken chart. |

---

### 5.5 Configuration & LLM Engine

#### Overview
The Configuration module provides system-wide defaults for persona voice style, conversation timing, and LLM provider settings.

#### Requirements

**Persona Configuration (Defaults)**

| ID | Requirement |
|----|-------------|
| CF-01 | The system shall persist a singleton persona-config record storing default character name, formality, verbosity, empathy, humor, speaking rate, pitch, voice ID, filler-word style, greeting style, and interrupt mode. |
| CF-02 | These defaults are applied when no active persona overrides the field. |

**Conversation Configuration**

| ID | Requirement |
|----|-------------|
| CF-03 | The system shall persist a singleton conversation-config record storing: answer delay (ms), max silence (ms), barge-in enabled flag, barge-in threshold (ms), minimum speech duration (ms), end-of-utterance gap (ms), max turn duration (ms), response timeout (ms), speaking rate, inter-word pause (ms). |
| CF-04 | All conversation-config fields shall be editable via sliders and number inputs in the Configuration tab and saved via a single Save button. |

**LLM Engine Configuration**

| ID | Requirement |
|----|-------------|
| CF-05 | The system shall persist a singleton LLM-config record storing: primary LLM engine (model name), fallback chain (ordered list of model names), per-call timeout (seconds), max retries, circuit-breaker failure threshold, and circuit-breaker recovery timeout. |
| CF-06 | LLM config changes shall take effect on the next LLM call; no server restart is required. |

**API Key Management**

| ID | Requirement |
|----|-------------|
| CF-07 | The API Keys tab shall list all third-party service integrations (e.g. Microsoft Graph, telephony provider, LLM provider). |
| CF-08 | For each integration, the UI shall show: service name, connection status, and a masked key indicator. |
| CF-09 | Operators shall be able to trigger a connectivity test per service; the result (success / error message) shall be displayed inline. |

---

### 5.6 Knowledge Base & Memory

#### Overview
The Memory module stores a curated set of Q&A pairs that the voice bot can draw on during calls, reducing hallucination and improving answer accuracy.

#### Requirements

| ID | Requirement |
|----|-------------|
| KB-01 | Memory entries shall each store a question, an answer, a confidence score, a tier (e.g. high / medium / low), a hit count, and a last-accessed timestamp. |
| KB-02 | Operators shall be able to create, edit, and delete memory entries via the dashboard. |
| KB-03 | A "Train" action shall submit the current memory corpus to the LLM for embedding/indexing. |
| KB-04 | The Memory Stats panel shall show total entries, hit rate, and last training timestamp. |
| KB-05 | The dashboard shall display the overall Memory Hit Rate KPI (percentage of calls where at least one memory entry was retrieved). |

---

### 5.7 Flow Builder

#### Overview
The Flow Builder allows operators to define visual conversation workflows — structured branching logic layered on top of the persona system.

#### Requirements

| ID | Requirement |
|----|-------------|
| FB-01 | Flow configs shall be stored as named, described JSON documents containing a `nodes` array and an `edges` array (directed graph). |
| FB-02 | Multiple flow configs may exist; operators may create, view, update, and delete configs. |
| FB-03 | The Flow Builder UI shall render the node/edge definition as a visual canvas with drag-and-drop editing. |
| FB-04 | The active flow config, if set, shall be applied on top of the active persona's system prompt during call setup. |

---

### 5.8 Email Agent

#### Overview
The Email Agent connects VoxAgent to a Microsoft Graph mailbox, allowing the bot to send call summaries, handle inbound email, and learn the operator's writing style.

#### Requirements

**Configuration**

| ID | Requirement |
|----|-------------|
| EA-01 | The Email Agent shall store a singleton config: Microsoft Azure tenant ID, client ID, client secret (encrypted at rest), mailbox user email, and enabled flag. |
| EA-02 | Operators shall be able to test the connection and see a success/failure status. |

**Inbox**

| ID | Requirement |
|----|-------------|
| EA-03 | The Email Agent tab shall display the mailbox inbox with threaded message view. |
| EA-04 | Operators shall be able to reply to email threads directly from the dashboard. |
| EA-05 | Operators shall be able to send a call summary email for a selected call, choosing the recipient address. |

**Writing Style**

| ID | Requirement |
|----|-------------|
| EA-06 | The system shall store a writing style profile: greeting style, sign-off phrase, tone, call-summary template, style examples, and learned patterns. |
| EA-07 | The "Learn Style" feature shall analyse existing email examples and update the learned patterns. |
| EA-08 | All outbound emails generated by the system (summaries, replies) shall use the learned writing style. |

---

### 5.9 Messaging Hub

#### Overview
The Messaging Hub provides a unified interface for sending messages across channels and viewing the message delivery log.

#### Requirements

| ID | Requirement |
|----|-------------|
| MH-01 | Operators shall be able to send messages via WhatsApp, Telegram, and Email from the dashboard. |
| MH-02 | Every sent message shall be logged with: channel, recipient, template name (if applicable), provider message ID, delivery status, and associated call ID. |
| MH-03 | The Messaging Hub UI shall display the full message log with channel icons and delivery status badges. |
| MH-04 | The voice bot shall be able to trigger outbound messages (e.g. post-call follow-up) via the messaging API. |

---

### 5.10 Calendar & Scheduling

#### Overview
The Calendar module allows the voice bot and operators to schedule follow-up appointments during or after a call.

#### Requirements

| ID | Requirement |
|----|-------------|
| CA-01 | The system shall support creating calendar invites with: title, description, start time, end time, timezone, attendee list, location, and Google Meet link. |
| CA-02 | Every calendar invite shall be linked to the originating call record via `callId`. |
| CA-03 | The `POST /v1/calendar/invite` endpoint shall return the calendar event ID from the upstream calendar provider. |
| CA-04 | The `GET /v1/calendar/slots` endpoint shall return available time slots for scheduling purposes. |

---

### 5.11 Mobile Application

#### Overview
The VoxAgent mobile app (iOS & Android, built with Expo React Native) gives field operators and managers a portable view of the call operation.

#### Requirements

**Dashboard Tab**

| ID | Requirement |
|----|-------------|
| MB-01 | The Dashboard tab shall display the same KPI cards as the web dashboard: Total Calls, Active Now, Completed Today, Success Rate, Avg Duration, AMD Accuracy, Memory Hit Rate, Bots Online. |

**Calls Tab**

| ID | Requirement |
|----|-------------|
| MB-02 | The Calls tab shall show a scrollable call list ordered by recency. |
| MB-03 | Each row shall display: direction indicator, phone number, customer name (if available), status badge, duration, and persona name. |
| MB-04 | A Filter Bar shall provide: direction chips (All / Inbound / Outbound), status chips (All / Live / Done / Failed), and a search field matching on caller name, number, or persona name. All filters shall be applied client-side. |
| MB-05 | Tapping a call row shall open a full-screen Call Detail modal containing: all call intelligence fields, transcript/summary section, and a "Play Recording" button that opens the recording URL. |
| MB-06 | The call list shall be refreshable via pull-to-refresh. |

**Personas Tab**

| ID | Requirement |
|----|-------------|
| MB-07 | The Personas tab shall list all personas with name, source badge, and active indicator. |
| MB-08 | Tapping a persona shall show a read-only trait summary. |

**Summary Tab**

| ID | Requirement |
|----|-------------|
| MB-09 | The Summary tab shall allow the operator to select a recent call and trigger the Email Agent to send a call summary to a specified recipient. |
| MB-10 | The tab shall display the generated summary text and the send status. |

---

## 6. Data Model Summary

| Table | Purpose | Key Relationships |
|-------|---------|-------------------|
| `calls` | One row per call, full intelligence payload | FK → `bots.id`, FK → `personas.id` |
| `bots` | Voice-bot instance configuration | Referenced by `calls.botId` |
| `personas` | Named persona versions | Has-many `persona_traits` |
| `persona_traits` | Versioned trait JSON per persona | FK → `personas.id` (cascade delete) |
| `persona_config` | Singleton default persona voice/style settings | — |
| `conversation_config` | Singleton conversation timing parameters | — |
| `llm_config` | Singleton LLM provider and circuit-breaker config | — |
| `flow_configs` | Named conversation flow definitions | — |
| `memory_entries` | Q&A knowledge base entries | — |
| `message_logs` | Outbound message delivery records | FK → `calls.id` (optional) |
| `calendar_invites` | Scheduled appointments | FK → `calls.id` (optional) |
| `email_agent_config` | Microsoft Graph mailbox credentials | — |
| `writing_style_profiles` | Learned email writing style | — |

---

## 7. API Surface

All endpoints are prefixed `/api` in the development proxy and served at `/v1/...` by the API server.

| Module | Method | Path | Description |
|--------|--------|------|-------------|
| Health | GET | `/v1/health` | Service health check |
| Calls | GET | `/v1/calls` | List calls (paginated) |
| | POST | `/v1/calls/dial` | Initiate outbound call |
| | POST | `/v1/calls/receive` | Inbound telephony webhook |
| | POST | `/v1/calls/inbound` | Create inbound call record |
| | GET | `/v1/calls/:id` | Call detail |
| | DELETE | `/v1/calls/:id` | Delete call |
| | POST | `/v1/calls/:id/transfer` | Transfer call |
| | POST | `/v1/calls/:id/conference` | Conference call |
| Personas | GET | `/v1/personas` | List personas |
| | POST | `/v1/personas` | Create persona |
| | GET | `/v1/personas/:id` | Persona detail |
| | PUT | `/v1/personas/:id/traits` | Update traits |
| | POST | `/v1/personas/:id/activate` | Activate persona |
| | POST | `/v1/personas/:id/regenerate` | AI-regenerate traits |
| | POST | `/v1/personas/:id/refine` | AI-refine traits |
| | POST | `/v1/personas/:id/test` | Test persona chat |
| | POST | `/v1/personas/:id/duplicate` | Duplicate persona |
| | DELETE | `/v1/personas/:id` | Delete persona |
| | GET | `/v1/personas/active/compose` | Get composed active prompt |
| Stats | GET | `/v1/stats/overview` | KPI card data |
| | GET | `/v1/stats/calls-by-hour` | 24-hour call volume |
| | GET | `/v1/stats/hangup-reasons` | Hangup reason distribution |
| | GET | `/v1/stats/connect-outcomes` | AMD outcome distribution |
| | GET | `/v1/stats/language-mix` | Language distribution |
| | GET | `/v1/stats/call-intelligence` | Interruption/escalation/barge-in stats |
| Bots | GET | `/v1/bots` | List bots |
| | POST | `/v1/bots` | Create bot |
| | GET | `/v1/bots/:id` | Bot detail |
| | PATCH | `/v1/bots/:id` | Update bot |
| | DELETE | `/v1/bots/:id` | Delete bot |
| Config | GET/PUT | `/v1/config/persona` | Persona defaults |
| | GET/PUT | `/v1/config/conversation` | Conversation timing |
| | GET/PUT | `/v1/config/llm` | LLM engine settings |
| | GET | `/v1/config/api-keys` | API key status |
| | POST | `/v1/config/api-keys/:service/test` | Test API key connectivity |
| Memory | GET | `/v1/memory/entries` | List memory entries |
| | POST | `/v1/memory/entries` | Create entry |
| | PUT | `/v1/memory/entries/:id` | Update entry |
| | DELETE | `/v1/memory/entries/:id` | Delete entry |
| | GET | `/v1/memory/stats` | Memory statistics |
| | POST | `/v1/memory/train` | Trigger training |
| Flow | GET | `/v1/flow/configs` | List flow configs |
| | POST | `/v1/flow/configs` | Create flow config |
| | GET | `/v1/flow/configs/:id` | Get flow config |
| | PUT | `/v1/flow/configs/:id` | Update flow config |
| | DELETE | `/v1/flow/configs/:id` | Delete flow config |
| Email Agent | GET/PUT | `/v1/email-agent/config` | Email agent config |
| | POST | `/v1/email-agent/test-connection` | Test mailbox connection |
| | GET | `/v1/email-agent/inbox` | Inbox messages |
| | GET | `/v1/email-agent/message/:id` | Message detail |
| | GET | `/v1/email-agent/thread/:id` | Thread view |
| | POST | `/v1/email-agent/reply` | Reply to thread |
| | POST | `/v1/email-agent/send-summary` | Send call summary email |
| | GET/PUT | `/v1/email-agent/style` | Writing style profile |
| | POST | `/v1/email-agent/learn-style` | Learn from examples |
| Messaging | POST | `/v1/messaging/whatsapp` | Send WhatsApp |
| | POST | `/v1/messaging/telegram` | Send Telegram |
| | POST | `/v1/messaging/email` | Send email |
| | GET | `/v1/messaging/logs` | Message delivery log |
| Calendar | POST | `/v1/calendar/invite` | Create calendar invite |
| | GET | `/v1/calendar/slots` | Get available slots |

---

## 8. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Performance** | API endpoints shall respond in < 500 ms under normal load for all non-LLM routes. LLM routes shall complete within 30 seconds or return a timeout error. |
| **Availability** | The API server shall expose a `/v1/health` endpoint for health monitoring. |
| **Data Integrity** | Persona traits are versioned; deleting a persona cascades to persona_traits but call records retain the `composedPrompt` snapshot. |
| **Security** | API keys stored in the DB shall be masked in all GET responses (only status, not the key value). The SESSION_SECRET environment variable shall be used for session signing and never logged. |
| **Logging** | All requests shall be logged via structured Pino logging (method, path, status, response time). |
| **Resilience** | The LLM engine shall implement a configurable circuit breaker: after N consecutive failures, requests are short-circuited until the recovery timeout elapses. |
| **Extensibility** | LLM provider is configurable; swapping the primary model requires only a config change, not a code deployment. |
| **Mobile** | The mobile app shall function on iOS 16+ and Android 12+ via Expo managed workflow. |

---

## 9. Constraints & Assumptions

| # | Statement |
|---|-----------|
| C1 | The system is single-tenant in v1.0. Multi-tenancy is out of scope. |
| C2 | Real-time TTS playback of persona voice in the browser is out of scope for v1.0. |
| C3 | Per-bot persona assignment is out of scope; persona is system-wide. |
| C4 | Multi-language persona profiles (separate trait sets per language) are out of scope for v1.0. |
| C5 | The telephony transport layer (SIP, carrier integration) is assumed to be provided by the operator's existing infrastructure; VoxAgent manages the logical call state via webhooks and API calls. |
| C6 | Calendar integration assumes Google Calendar (Meet link generation); Microsoft 365 calendar is a future integration. |
| C7 | Email integration requires a Microsoft Azure application registration with delegated Graph API permissions. |
| C8 | All timestamps are stored and returned in UTC. |

---

## 10. Glossary

| Term | Definition |
|------|-----------|
| **AMD** | Answering Machine Detection — classifying whether a picked-up call was answered by a human, voicemail, IVR, or not answered. |
| **Barge-in** | The act of a customer speaking while the bot is talking, interrupting the bot's current utterance. |
| **Composed Prompt** | The full system-prompt string generated by PersonaComposer from a persona's trait data, snapshotted at call start. |
| **Connect Outcome** | The result of AMD: one of HUMAN, VOICEMAIL, IVR, NO_ANSWER. |
| **Disposition** | The CRM-level outcome of a call (e.g. TRANSFERRED, BOT_HUNGUP, CUSTOMER_HANGUP). |
| **Escalation** | A moment in a call where the bot determines the conversation should be routed to a human agent. |
| **Fallback Chain** | An ordered list of LLM models to try if the primary model fails or times out. |
| **Memory Hit** | A call during which at least one memory entry was retrieved and used to answer a customer question. |
| **Persona** | A named, versioned AI persona with structured traits that determine the voice bot's identity, language, tone, voice, and behaviour. |
| **PersonaComposer** | The backend service module that translates persona traits into a natural-language system prompt. |
| **SIP** | Session Initiation Protocol — the telephony signalling protocol used for VoIP call setup. |
| **Trait** | A single configurable attribute of a persona (e.g. formality score, jargon tags, escalation trigger). |
| **Voice Bot** | The AI agent that conducts telephone conversations on behalf of the operator using a configured persona and system prompt. |

---

*End of Document*
# VoxAgent — Business Requirements Document

**Version:** 1.0  
**Date:** August 12, 2026  
**Status:** Final  
**Prepared by:** VoxAgent Product Team

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Vision & Goals](#2-product-vision--goals)
3. [Stakeholders](#3-stakeholders)
4. [System Architecture Overview](#4-system-architecture-overview)
5. [Feature Areas](#5-feature-areas)
   - 5.1 [Persona Engine](#51-persona-engine)
   - 5.2 [Call Management](#52-call-management)
   - 5.3 [Bot Network](#53-bot-network)
   - 5.4 [Analytics Dashboard](#54-analytics-dashboard)
   - 5.5 [Configuration & LLM Engine](#55-configuration--llm-engine)
   - 5.6 [Knowledge Base & Memory](#56-knowledge-base--memory)
   - 5.7 [Flow Builder](#57-flow-builder)
   - 5.8 [Email Agent](#58-email-agent)
   - 5.9 [Messaging Hub](#59-messaging-hub)
   - 5.10 [Calendar & Scheduling](#510-calendar--scheduling)
   - 5.11 [Mobile Application](#511-mobile-application)
6. [Data Model Summary](#6-data-model-summary)
7. [API Surface](#7-api-surface)
8. [Non-Functional Requirements](#8-non-functional-requirements)
9. [Constraints & Assumptions](#9-constraints--assumptions)
10. [Glossary](#10-glossary)

---

## 1. Executive Summary

VoxAgent is an enterprise AI voice-bot control plane that enables organisations to deploy, configure, monitor, and continuously improve AI-powered telephone agents. The platform allows operators to:

- Define rich voice-bot personas backed by structured trait data and AI-generated system prompts.
- Initiate and receive telephone calls through a managed bot fleet.
- Monitor call analytics, transcripts, recordings, and intelligence metrics in real time.
- Orchestrate post-call workflows including email summaries, calendar invites, and CRM disposition.
- Control the entire system from a web dashboard or a companion mobile application.

VoxAgent is delivered as a monorepo consisting of an Express API server, a React/Vite web dashboard, an Expo React Native mobile app, and shared TypeScript libraries for the database schema, API client, and Zod validation schemas.

---

## 2. Product Vision & Goals

### Vision
Give any organisation the ability to deploy a human-quality AI telephone agent in hours — not months — and continuously refine it without engineering support.

### Primary Goals

| # | Goal | Measure of Success |
|---|------|-------------------|
| G1 | Reduce time-to-deploy a new voice persona | < 30 min from first login to first live call |
| G2 | Ensure system-prompt integrity across persona edits | Composed prompt snapshotted on every call record |
| G3 | Block misconfigured personas from reaching customers | Activate endpoint enforces identity-field validation (HTTP 422 on failure) |
| G4 | Give operators full call intelligence on every interaction | AMD rate, language mix, barge-in, escalation, transcript available per call |
| G5 | Enable monitoring from a mobile device | Full call detail, filters, and recordings accessible on iOS/Android |
| G6 | Support post-call operational workflows | Summary emails, calendar invites, and CRM disposition sent automatically |

---

## 3. Stakeholders

| Role | Responsibility |
|------|----------------|
| **Contact Centre Manager** | Configures bots, personas, and calling hours; reviews analytics |
| **AI/Prompt Engineer** | Authors and refines persona traits; uses AI regenerate and refine flows |
| **Operations Supervisor** | Monitors live and historical calls; dispatches transfers; reviews recordings |
| **Mobile Field Operator** | Reviews call activity and transcripts on the companion mobile app |
| **IT Administrator** | Manages API keys, LLM provider config, SIP/WhatsApp integration credentials |
| **VoxAgent Platform Team** | Develops and maintains the product |

---

## 4. System Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Client Layer                         │
│  React/Vite Dashboard          Expo Mobile App          │
│  (artifacts/dashboard)         (artifacts/mobile)       │
└───────────────────┬─────────────────────┬───────────────┘
                    │  REST + JSON         │
┌───────────────────▼─────────────────────▼───────────────┐
│                 API Server (Express 5)                   │
│              (artifacts/api-server)                      │
│                                                         │
│  Routes: calls · personas · bots · stats · config       │
│           memory · flow · email-agent · messaging        │
│           calendar · api-keys · health                   │
│                                                         │
│  Services: PersonaComposer · PersonaService             │
│            CallConnectService · Logger                   │
└───────────────────────────┬─────────────────────────────┘
                            │  Drizzle ORM
┌───────────────────────────▼─────────────────────────────┐
│                  PostgreSQL Database                     │
│  Tables: calls · bots · personas · persona_traits       │
│          persona_config · conversation_config · llm_config│
│          flow_configs · memory_entries · message_logs   │
│          calendar_invites · email_agent_config          │
│          writing_style_profiles                         │
└─────────────────────────────────────────────────────────┘
```

### Shared Libraries

| Package | Purpose |
|---------|---------|
| `@workspace/db` | Drizzle schema, migration runner, typed table exports |
| `@workspace/api-zod` | Zod schemas for all request/response shapes |
| `@workspace/api-client-react` | React Query hooks generated from the OpenAPI spec |

---

## 5. Feature Areas

### 5.1 Persona Engine

#### Overview
The Persona Engine is the core differentiation of VoxAgent. It allows operators to create named, versioned AI personas — each backed by structured trait data — and have those traits automatically translated into a voice-bot system prompt by the PersonaComposer service.

#### Requirements

**Persona Lifecycle**

| ID | Requirement |
|----|-------------|
| PE-01 | The system shall maintain a library of named personas, each with a unique name, description, source badge (Manual / Library / AI-Generated), version counter, and active flag. |
| PE-02 | At most one persona may be active at a time. Activating a persona deactivates all others atomically. |
| PE-03 | Activating a persona with empty `role_title`, `backstory`, or `goals` fields shall be rejected with HTTP 422 and a human-readable error message. |
| PE-04 | Personas may be duplicated; duplicates are assigned a new unique name and version 1. |
| PE-05 | Personas may be soft-deleted. Call records that reference a deleted persona shall display a "Deleted persona" label rather than a blank. |
| PE-06 | Five pre-seeded library personas shall be available at first launch (Hotel Receptionist, Hospital Appointment Desk, Bank Customer Care, E-commerce Order Support, Debt Collection Agent). |

**Trait Structure**

Persona traits are organised into five sections:

| Section | Fields |
|---------|--------|
| **Identity** | role_title, character, backstory, goals |
| **Language** | jargon (tags), greeting phrases, closing phrases, forbidden phrases, sample utterances |
| **Tone** | formality (1–10), verbosity (1–10), empathy (1–10), humor (1–10) |
| **Voice** | speaking pace, pitch, Deepgram voice hint, gender |
| **Behavior** | interrupt tolerance, silence strategy, escalation trigger, do-rules (tags), don't-rules (tags) |

| ID | Requirement |
|----|-------------|
| PE-07 | The trait editor shall provide sliders for all numeric tone fields (range 1–10). |
| PE-08 | Jargon, greeting/closing/forbidden phrases, rules, and sample utterances shall use a tag-style editor supporting add and remove operations. |
| PE-09 | Pace, pitch, interrupt tolerance, and silence strategy shall use dropdown selectors. |
| PE-10 | The editor shall track an unsaved-changes ("dirty") state, show a yellow indicator on the Edit Traits tab, display a browser `beforeunload` warning if the user closes the tab with unsaved changes, and show a confirm dialog before navigating away in-app. |

**AI-Powered Authoring**

| ID | Requirement |
|----|-------------|
| PE-11 | The "Generate Traits" flow shall accept a persona name and optional description, call the configured LLM with a 30-second timeout, and return a fully populated trait object. |
| PE-12 | The "Refine with AI" flow shall accept the current trait JSON and a plain-English instruction, call the LLM, and return updated traits for side-by-side diff review before the operator confirms the save. |
| PE-13 | LLM calls shall use the primary LLM engine with fallback to the configured fallback chain. All trait generation calls shall be logged with success/failure status. |
| PE-14 | If an LLM call exceeds 30 seconds or fails, a visible Retry button shall appear; the UI shall never display an infinite spinner. |

**Persona Test Chat**

| ID | Requirement |
|----|-------------|
| PE-15 | The Test Persona panel shall run 3–4 sample dialogue exchanges using the composed system prompt and display bot responses inline. |
| PE-16 | The composed system prompt (the full text the voice bot receives) shall be visible in the Test Persona panel. |

**PersonaComposer Service**

| ID | Requirement |
|----|-------------|
| PE-17 | The PersonaComposer service shall translate numeric tone values and all trait fields into structured, natural-language guidance sections (identity, language, tone, behavior, escalation). |
| PE-18 | The service shall export `validatePersonaForVoiceBot(traits)` returning `{ valid: boolean, issues: string[] }`. This function shall be called before activation and before inbound call stamping. |
| PE-19 | The composed prompt, persona ID, and persona name shall be snapshotted onto the call record at dial time and stored immutably — subsequent trait edits shall not alter the snapshot. |

---

### 5.2 Call Management

#### Overview
VoxAgent manages the full lifecycle of outbound and inbound telephone calls, persisting intelligence data on every interaction.

#### Requirements

**Call Record Schema**

Every call record contains:

| Field | Description |
|-------|-------------|
| `direction` | INBOUND or OUTBOUND |
| `status` | RINGING · IN_PROGRESS · COMPLETED · FAILED |
| `customerNumber` | E.164 phone number |
| `customerName` | Optional display name |
| `botId` | Originating/receiving bot |
| `personaId` | Persona active at call start |
| `composedPrompt` | Full system prompt snapshot |
| `connectOutcome` | AMD result: HUMAN · VOICEMAIL · IVR · NO_ANSWER |
| `languageDetected` | BCP-47 code |
| `duration` | Seconds |
| `hangupReason` | Who ended the call |
| `finalDisposition` | CRM outcome |
| `interruptionCount` | Customer barge-in events |
| `escalationCount` | Times escalation rule fired |
| `languageSwitches` | JSON array of switch events |
| `transcript` | Full turn-by-turn transcript |
| `summary` | AI-generated call summary |
| `recordingUrl` | URL of call recording |

**Outbound Calls**

| ID | Requirement |
|----|-------------|
| CL-01 | Operators shall initiate outbound calls by supplying a destination E.164 number and selecting a bot. |
| CL-02 | The active persona's traits shall be validated before dialling; invalid personas shall be rejected with an error shown in the UI. |
| CL-03 | AMD classification (Human / Voicemail / IVR / No Answer) shall be performed and stored on every outbound call. |
| CL-04 | Calling-hours rules configured on the bot shall be enforced; calls outside permitted hours shall be rejected. |

**Inbound Calls**

| ID | Requirement |
|----|-------------|
| CL-05 | The `POST /v1/calls/receive` webhook endpoint shall accept inbound telephony callbacks and create an INBOUND call record. |
| CL-06 | If an active persona exists and passes `validatePersonaForVoiceBot`, its ID and composed prompt shall be stamped onto the call record. |
| CL-07 | If no valid active persona exists, the call shall still be recorded; a warning shall be logged and the persona fields left null. |

**Call Operations**

| ID | Requirement |
|----|-------------|
| CL-08 | Operators shall be able to transfer a call to a specified destination from the Call Log. |
| CL-09 | Operators shall be able to initiate a conference on an active call. |
| CL-10 | Call records shall be deletable by administrators. |

**Call Log UI**

| ID | Requirement |
|----|-------------|
| CL-11 | The Call Log shall display direction, phone number, status badge, connect outcome, duration, disposition, language, persona name, and start time for each call. |
| CL-12 | Calls with status RINGING or IN_PROGRESS shall display a pulsing animated live indicator inside their status badge. |
| CL-13 | The persona name column shall show the persona name as snapshotted at call time. Calls made before persona stamping was introduced, and calls where no persona was active, shall display "—". Calls that used a since-deleted persona shall display "Deleted persona" with a muted label style. |
| CL-14 | Clicking a call row shall open a detail panel showing all call intelligence fields, transcript/summary, and a recording link. |
| CL-15 | The Call Log shall support filtering by direction (All / Inbound / Outbound) and status (All / Active / Completed / Failed) and refreshing on demand. |

---

### 5.3 Bot Network

#### Overview
The Bot Network module manages the fleet of voice-bot instances. Each bot is a configured telephony endpoint that can handle calls in one or both directions.

#### Requirements

| ID | Requirement |
|----|-------------|
| BN-01 | Each bot shall have a display name, direction (INBOUND / OUTBOUND / BOTH), SIP extension/domain, email address, and WhatsApp number. |
| BN-02 | Bots shall store supported languages and a default greeting language. |
| BN-03 | Bots shall store calling-hours rules (timezone, permitted windows) enforced at dial time. |
| BN-04 | Per-bot configuration shall include: answer delay (ms), barge-in threshold (ms), silence recovery (seconds), backchannel threshold (ms), AMD opening script, greeting script, max retries. |
| BN-05 | Per-bot escalation configuration shall include: escalation queue target and conversation-intelligence controls (escalation trigger sensitivity). |
| BN-06 | The Bot Network UI shall display each bot's status (ONLINE / OFFLINE / BUSY), active call count, and all configuration fields. |
| BN-07 | Operators shall be able to create, edit, and delete bots from the dashboard. |

---

### 5.4 Analytics Dashboard

#### Overview
The Analytics Dashboard provides a real-time overview of the voice-bot operation through KPI cards and interactive charts.

#### Requirements

**KPI Cards**

| ID | Requirement |
|----|-------------|
| DB-01 | The dashboard header shall display: Total Calls, Active Now, Completed Today, Success Rate (%), Average Duration, AMD Accuracy (%), Memory Hit Rate (%), and Bots Online count. |

**Charts**

| ID | Chart | Requirement |
|----|-------|-------------|
| DB-02 | Call Volume (24 h) | Hourly bar chart of call volume for the last 24 hours; bars coloured by direction. |
| DB-03 | Hangup Reasons | Horizontal bar chart showing the distribution of `hangupReason` values across all calls. |
| DB-04 | Connect Outcomes | Horizontal bar chart of AMD classification results (Human / Voicemail / IVR / No Answer). |
| DB-05 | Language Mix | Pie chart showing the percentage breakdown of `languageDetected` values across all calls. |
| DB-06 | Call Intelligence | Stat list showing: average interruptions per call, average escalations per call, barge-in rate (%), average language switches per call; computed across all stored call records. |

**Data Freshness**

| ID | Requirement |
|----|-------------|
| DB-07 | All dashboard data shall be fetched on mount and on manual Refresh. Polling is not required. |
| DB-08 | Charts with no data (e.g. Connect Outcomes before any AMD calls are made) shall display a "No data yet" placeholder rather than a blank or broken chart. |

---

### 5.5 Configuration & LLM Engine

#### Overview
The Configuration module provides system-wide defaults for persona voice style, conversation timing, and LLM provider settings.

#### Requirements

**Persona Configuration (Defaults)**

| ID | Requirement |
|----|-------------|
| CF-01 | The system shall persist a singleton persona-config record storing default character name, formality, verbosity, empathy, humor, speaking rate, pitch, voice ID, filler-word style, greeting style, and interrupt mode. |
| CF-02 | These defaults are applied when no active persona overrides the field. |

**Conversation Configuration**

| ID | Requirement |
|----|-------------|
| CF-03 | The system shall persist a singleton conversation-config record storing: answer delay (ms), max silence (ms), barge-in enabled flag, barge-in threshold (ms), minimum speech duration (ms), end-of-utterance gap (ms), max turn duration (ms), response timeout (ms), speaking rate, inter-word pause (ms). |
| CF-04 | All conversation-config fields shall be editable via sliders and number inputs in the Configuration tab and saved via a single Save button. |

**LLM Engine Configuration**

| ID | Requirement |
|----|-------------|
| CF-05 | The system shall persist a singleton LLM-config record storing: primary LLM engine (model name), fallback chain (ordered list of model names), per-call timeout (seconds), max retries, circuit-breaker failure threshold, and circuit-breaker recovery timeout. |
| CF-06 | LLM config changes shall take effect on the next LLM call; no server restart is required. |

**API Key Management**

| ID | Requirement |
|----|-------------|
| CF-07 | The API Keys tab shall list all third-party service integrations (e.g. Microsoft Graph, telephony provider, LLM provider). |
| CF-08 | For each integration, the UI shall show: service name, connection status, and a masked key indicator. |
| CF-09 | Operators shall be able to trigger a connectivity test per service; the result (success / error message) shall be displayed inline. |

---

### 5.6 Knowledge Base & Memory

#### Overview
The Memory module stores a curated set of Q&A pairs that the voice bot can draw on during calls, reducing hallucination and improving answer accuracy.

#### Requirements

| ID | Requirement |
|----|-------------|
| KB-01 | Memory entries shall each store a question, an answer, a confidence score, a tier (e.g. high / medium / low), a hit count, and a last-accessed timestamp. |
| KB-02 | Operators shall be able to create, edit, and delete memory entries via the dashboard. |
| KB-03 | A "Train" action shall submit the current memory corpus to the LLM for embedding/indexing. |
| KB-04 | The Memory Stats panel shall show total entries, hit rate, and last training timestamp. |
| KB-05 | The dashboard shall display the overall Memory Hit Rate KPI (percentage of calls where at least one memory entry was retrieved). |

---

### 5.7 Flow Builder

#### Overview
The Flow Builder allows operators to define visual conversation workflows — structured branching logic layered on top of the persona system.

#### Requirements

| ID | Requirement |
|----|-------------|
| FB-01 | Flow configs shall be stored as named, described JSON documents containing a `nodes` array and an `edges` array (directed graph). |
| FB-02 | Multiple flow configs may exist; operators may create, view, update, and delete configs. |
| FB-03 | The Flow Builder UI shall render the node/edge definition as a visual canvas with drag-and-drop editing. |
| FB-04 | The active flow config, if set, shall be applied on top of the active persona's system prompt during call setup. |

---

### 5.8 Email Agent

#### Overview
The Email Agent connects VoxAgent to a Microsoft Graph mailbox, allowing the bot to send call summaries, handle inbound email, and learn the operator's writing style.

#### Requirements

**Configuration**

| ID | Requirement |
|----|-------------|
| EA-01 | The Email Agent shall store a singleton config: Microsoft Azure tenant ID, client ID, client secret (encrypted at rest), mailbox user email, and enabled flag. |
| EA-02 | Operators shall be able to test the connection and see a success/failure status. |

**Inbox**

| ID | Requirement |
|----|-------------|
| EA-03 | The Email Agent tab shall display the mailbox inbox with threaded message view. |
| EA-04 | Operators shall be able to reply to email threads directly from the dashboard. |
| EA-05 | Operators shall be able to send a call summary email for a selected call, choosing the recipient address. |

**Writing Style**

| ID | Requirement |
|----|-------------|
| EA-06 | The system shall store a writing style profile: greeting style, sign-off phrase, tone, call-summary template, style examples, and learned patterns. |
| EA-07 | The "Learn Style" feature shall analyse existing email examples and update the learned patterns. |
| EA-08 | All outbound emails generated by the system (summaries, replies) shall use the learned writing style. |

---

### 5.9 Messaging Hub

#### Overview
The Messaging Hub provides a unified interface for sending messages across channels and viewing the message delivery log.

#### Requirements

| ID | Requirement |
|----|-------------|
| MH-01 | Operators shall be able to send messages via WhatsApp, Telegram, and Email from the dashboard. |
| MH-02 | Every sent message shall be logged with: channel, recipient, template name (if applicable), provider message ID, delivery status, and associated call ID. |
| MH-03 | The Messaging Hub UI shall display the full message log with channel icons and delivery status badges. |
| MH-04 | The voice bot shall be able to trigger outbound messages (e.g. post-call follow-up) via the messaging API. |

---

### 5.10 Calendar & Scheduling

#### Overview
The Calendar module allows the voice bot and operators to schedule follow-up appointments during or after a call.

#### Requirements

| ID | Requirement |
|----|-------------|
| CA-01 | The system shall support creating calendar invites with: title, description, start time, end time, timezone, attendee list, location, and Google Meet link. |
| CA-02 | Every calendar invite shall be linked to the originating call record via `callId`. |
| CA-03 | The `POST /v1/calendar/invite` endpoint shall return the calendar event ID from the upstream calendar provider. |
| CA-04 | The `GET /v1/calendar/slots` endpoint shall return available time slots for scheduling purposes. |

---

### 5.11 Mobile Application

#### Overview
The VoxAgent mobile app (iOS & Android, built with Expo React Native) gives field operators and managers a portable view of the call operation.

#### Requirements

**Dashboard Tab**

| ID | Requirement |
|----|-------------|
| MB-01 | The Dashboard tab shall display the same KPI cards as the web dashboard: Total Calls, Active Now, Completed Today, Success Rate, Avg Duration, AMD Accuracy, Memory Hit Rate, Bots Online. |

**Calls Tab**

| ID | Requirement |
|----|-------------|
| MB-02 | The Calls tab shall show a scrollable call list ordered by recency. |
| MB-03 | Each row shall display: direction indicator, phone number, customer name (if available), status badge, duration, and persona name. |
| MB-04 | A Filter Bar shall provide: direction chips (All / Inbound / Outbound), status chips (All / Live / Done / Failed), and a search field matching on caller name, number, or persona name. All filters shall be applied client-side. |
| MB-05 | Tapping a call row shall open a full-screen Call Detail modal containing: all call intelligence fields, transcript/summary section, and a "Play Recording" button that opens the recording URL. |
| MB-06 | The call list shall be refreshable via pull-to-refresh. |

**Personas Tab**

| ID | Requirement |
|----|-------------|
| MB-07 | The Personas tab shall list all personas with name, source badge, and active indicator. |
| MB-08 | Tapping a persona shall show a read-only trait summary. |

**Summary Tab**

| ID | Requirement |
|----|-------------|
| MB-09 | The Summary tab shall allow the operator to select a recent call and trigger the Email Agent to send a call summary to a specified recipient. |
| MB-10 | The tab shall display the generated summary text and the send status. |

---

## 6. Data Model Summary

| Table | Purpose | Key Relationships |
|-------|---------|-------------------|
| `calls` | One row per call, full intelligence payload | FK → `bots.id`, FK → `personas.id` |
| `bots` | Voice-bot instance configuration | Referenced by `calls.botId` |
| `personas` | Named persona versions | Has-many `persona_traits` |
| `persona_traits` | Versioned trait JSON per persona | FK → `personas.id` (cascade delete) |
| `persona_config` | Singleton default persona voice/style settings | — |
| `conversation_config` | Singleton conversation timing parameters | — |
| `llm_config` | Singleton LLM provider and circuit-breaker config | — |
| `flow_configs` | Named conversation flow definitions | — |
| `memory_entries` | Q&A knowledge base entries | — |
| `message_logs` | Outbound message delivery records | FK → `calls.id` (optional) |
| `calendar_invites` | Scheduled appointments | FK → `calls.id` (optional) |
| `email_agent_config` | Microsoft Graph mailbox credentials | — |
| `writing_style_profiles` | Learned email writing style | — |

---

## 7. API Surface

All endpoints are prefixed `/api` in the development proxy and served at `/v1/...` by the API server.

| Module | Method | Path | Description |
|--------|--------|------|-------------|
| Health | GET | `/v1/health` | Service health check |
| Calls | GET | `/v1/calls` | List calls (paginated) |
| | POST | `/v1/calls/dial` | Initiate outbound call |
| | POST | `/v1/calls/receive` | Inbound telephony webhook |
| | POST | `/v1/calls/inbound` | Create inbound call record |
| | GET | `/v1/calls/:id` | Call detail |
| | DELETE | `/v1/calls/:id` | Delete call |
| | POST | `/v1/calls/:id/transfer` | Transfer call |
| | POST | `/v1/calls/:id/conference` | Conference call |
| Personas | GET | `/v1/personas` | List personas |
| | POST | `/v1/personas` | Create persona |
| | GET | `/v1/personas/:id` | Persona detail |
| | PUT | `/v1/personas/:id/traits` | Update traits |
| | POST | `/v1/personas/:id/activate` | Activate persona |
| | POST | `/v1/personas/:id/regenerate` | AI-regenerate traits |
| | POST | `/v1/personas/:id/refine` | AI-refine traits |
| | POST | `/v1/personas/:id/test` | Test persona chat |
| | POST | `/v1/personas/:id/duplicate` | Duplicate persona |
| | DELETE | `/v1/personas/:id` | Delete persona |
| | GET | `/v1/personas/active/compose` | Get composed active prompt |
| Stats | GET | `/v1/stats/overview` | KPI card data |
| | GET | `/v1/stats/calls-by-hour` | 24-hour call volume |
| | GET | `/v1/stats/hangup-reasons` | Hangup reason distribution |
| | GET | `/v1/stats/connect-outcomes` | AMD outcome distribution |
| | GET | `/v1/stats/language-mix` | Language distribution |
| | GET | `/v1/stats/call-intelligence` | Interruption/escalation/barge-in stats |
| Bots | GET | `/v1/bots` | List bots |
| | POST | `/v1/bots` | Create bot |
| | GET | `/v1/bots/:id` | Bot detail |
| | PATCH | `/v1/bots/:id` | Update bot |
| | DELETE | `/v1/bots/:id` | Delete bot |
| Config | GET/PUT | `/v1/config/persona` | Persona defaults |
| | GET/PUT | `/v1/config/conversation` | Conversation timing |
| | GET/PUT | `/v1/config/llm` | LLM engine settings |
| | GET | `/v1/config/api-keys` | API key status |
| | POST | `/v1/config/api-keys/:service/test` | Test API key connectivity |
| Memory | GET | `/v1/memory/entries` | List memory entries |
| | POST | `/v1/memory/entries` | Create entry |
| | PUT | `/v1/memory/entries/:id` | Update entry |
| | DELETE | `/v1/memory/entries/:id` | Delete entry |
| | GET | `/v1/memory/stats` | Memory statistics |
| | POST | `/v1/memory/train` | Trigger training |
| Flow | GET | `/v1/flow/configs` | List flow configs |
| | POST | `/v1/flow/configs` | Create flow config |
| | GET | `/v1/flow/configs/:id` | Get flow config |
| | PUT | `/v1/flow/configs/:id` | Update flow config |
| | DELETE | `/v1/flow/configs/:id` | Delete flow config |
| Email Agent | GET/PUT | `/v1/email-agent/config` | Email agent config |
| | POST | `/v1/email-agent/test-connection` | Test mailbox connection |
| | GET | `/v1/email-agent/inbox` | Inbox messages |
| | GET | `/v1/email-agent/message/:id` | Message detail |
| | GET | `/v1/email-agent/thread/:id` | Thread view |
| | POST | `/v1/email-agent/reply` | Reply to thread |
| | POST | `/v1/email-agent/send-summary` | Send call summary email |
| | GET/PUT | `/v1/email-agent/style` | Writing style profile |
| | POST | `/v1/email-agent/learn-style` | Learn from examples |
| Messaging | POST | `/v1/messaging/whatsapp` | Send WhatsApp |
| | POST | `/v1/messaging/telegram` | Send Telegram |
| | POST | `/v1/messaging/email` | Send email |
| | GET | `/v1/messaging/logs` | Message delivery log |
| Calendar | POST | `/v1/calendar/invite` | Create calendar invite |
| | GET | `/v1/calendar/slots` | Get available slots |

---

## 8. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Performance** | API endpoints shall respond in < 500 ms under normal load for all non-LLM routes. LLM routes shall complete within 30 seconds or return a timeout error. |
| **Availability** | The API server shall expose a `/v1/health` endpoint for health monitoring. |
| **Data Integrity** | Persona traits are versioned; deleting a persona cascades to persona_traits but call records retain the `composedPrompt` snapshot. |
| **Security** | API keys stored in the DB shall be masked in all GET responses (only status, not the key value). The SESSION_SECRET environment variable shall be used for session signing and never logged. |
| **Logging** | All requests shall be logged via structured Pino logging (method, path, status, response time). |
| **Resilience** | The LLM engine shall implement a configurable circuit breaker: after N consecutive failures, requests are short-circuited until the recovery timeout elapses. |
| **Extensibility** | LLM provider is configurable; swapping the primary model requires only a config change, not a code deployment. |
| **Mobile** | The mobile app shall function on iOS 16+ and Android 12+ via Expo managed workflow. |

---

## 9. Constraints & Assumptions

| # | Statement |
|---|-----------|
| C1 | The system is single-tenant in v1.0. Multi-tenancy is out of scope. |
| C2 | Real-time TTS playback of persona voice in the browser is out of scope for v1.0. |
| C3 | Per-bot persona assignment is out of scope; persona is system-wide. |
| C4 | Multi-language persona profiles (separate trait sets per language) are out of scope for v1.0. |
| C5 | The telephony transport layer (SIP, carrier integration) is assumed to be provided by the operator's existing infrastructure; VoxAgent manages the logical call state via webhooks and API calls. |
| C6 | Calendar integration assumes Google Calendar (Meet link generation); Microsoft 365 calendar is a future integration. |
| C7 | Email integration requires a Microsoft Azure application registration with delegated Graph API permissions. |
| C8 | All timestamps are stored and returned in UTC. |

---

## 10. Glossary

| Term | Definition |
|------|-----------|
| **AMD** | Answering Machine Detection — classifying whether a picked-up call was answered by a human, voicemail, IVR, or not answered. |
| **Barge-in** | The act of a customer speaking while the bot is talking, interrupting the bot's current utterance. |
| **Composed Prompt** | The full system-prompt string generated by PersonaComposer from a persona's trait data, snapshotted at call start. |
| **Connect Outcome** | The result of AMD: one of HUMAN, VOICEMAIL, IVR, NO_ANSWER. |
| **Disposition** | The CRM-level outcome of a call (e.g. TRANSFERRED, BOT_HUNGUP, CUSTOMER_HANGUP). |
| **Escalation** | A moment in a call where the bot determines the conversation should be routed to a human agent. |
| **Fallback Chain** | An ordered list of LLM models to try if the primary model fails or times out. |
| **Memory Hit** | A call during which at least one memory entry was retrieved and used to answer a customer question. |
| **Persona** | A named, versioned AI persona with structured traits that determine the voice bot's identity, language, tone, voice, and behaviour. |
| **PersonaComposer** | The backend service module that translates persona traits into a natural-language system prompt. |
| **SIP** | Session Initiation Protocol — the telephony signalling protocol used for VoIP call setup. |
| **Trait** | A single configurable attribute of a persona (e.g. formality score, jargon tags, escalation trigger). |
| **Voice Bot** | The AI agent that conducts telephone conversations on behalf of the operator using a configured persona and system prompt. |

---

*End of Document*
# VoxAgent — Business Requirements Document

**Version:** 1.0  
**Date:** August 12, 2026  
**Status:** Final  
**Prepared by:** VoxAgent Product Team

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Vision & Goals](#2-product-vision--goals)
3. [Stakeholders](#3-stakeholders)
4. [System Architecture Overview](#4-system-architecture-overview)
5. [Feature Areas](#5-feature-areas)
   - 5.1 [Persona Engine](#51-persona-engine)
   - 5.2 [Call Management](#52-call-management)
   - 5.3 [Bot Network](#53-bot-network)
   - 5.4 [Analytics Dashboard](#54-analytics-dashboard)
   - 5.5 [Configuration & LLM Engine](#55-configuration--llm-engine)
   - 5.6 [Knowledge Base & Memory](#56-knowledge-base--memory)
   - 5.7 [Flow Builder](#57-flow-builder)
   - 5.8 [Email Agent](#58-email-agent)
   - 5.9 [Messaging Hub](#59-messaging-hub)
   - 5.10 [Calendar & Scheduling](#510-calendar--scheduling)
   - 5.11 [Mobile Application](#511-mobile-application)
6. [Data Model Summary](#6-data-model-summary)
7. [API Surface](#7-api-surface)
8. [Non-Functional Requirements](#8-non-functional-requirements)
9. [Constraints & Assumptions](#9-constraints--assumptions)
10. [Glossary](#10-glossary)

---

## 1. Executive Summary

VoxAgent is an enterprise AI voice-bot control plane that enables organisations to deploy, configure, monitor, and continuously improve AI-powered telephone agents. The platform allows operators to:

- Define rich voice-bot personas backed by structured trait data and AI-generated system prompts.
- Initiate and receive telephone calls through a managed bot fleet.
- Monitor call analytics, transcripts, recordings, and intelligence metrics in real time.
- Orchestrate post-call workflows including email summaries, calendar invites, and CRM disposition.
- Control the entire system from a web dashboard or a companion mobile application.

VoxAgent is delivered as a monorepo consisting of an Express API server, a React/Vite web dashboard, an Expo React Native mobile app, and shared TypeScript libraries for the database schema, API client, and Zod validation schemas.

---

## 2. Product Vision & Goals

### Vision
Give any organisation the ability to deploy a human-quality AI telephone agent in hours — not months — and continuously refine it without engineering support.

### Primary Goals

| # | Goal | Measure of Success |
|---|------|-------------------|
| G1 | Reduce time-to-deploy a new voice persona | < 30 min from first login to first live call |
| G2 | Ensure system-prompt integrity across persona edits | Composed prompt snapshotted on every call record |
| G3 | Block misconfigured personas from reaching customers | Activate endpoint enforces identity-field validation (HTTP 422 on failure) |
| G4 | Give operators full call intelligence on every interaction | AMD rate, language mix, barge-in, escalation, transcript available per call |
| G5 | Enable monitoring from a mobile device | Full call detail, filters, and recordings accessible on iOS/Android |
| G6 | Support post-call operational workflows | Summary emails, calendar invites, and CRM disposition sent automatically |

---

## 3. Stakeholders

| Role | Responsibility |
|------|----------------|
| **Contact Centre Manager** | Configures bots, personas, and calling hours; reviews analytics |
| **AI/Prompt Engineer** | Authors and refines persona traits; uses AI regenerate and refine flows |
| **Operations Supervisor** | Monitors live and historical calls; dispatches transfers; reviews recordings |
| **Mobile Field Operator** | Reviews call activity and transcripts on the companion mobile app |
| **IT Administrator** | Manages API keys, LLM provider config, SIP/WhatsApp integration credentials |
| **VoxAgent Platform Team** | Develops and maintains the product |

---

## 4. System Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Client Layer                         │
│  React/Vite Dashboard          Expo Mobile App          │
│  (artifacts/dashboard)         (artifacts/mobile)       │
└───────────────────┬─────────────────────┬───────────────┘
                    │  REST + JSON         │
┌───────────────────▼─────────────────────▼───────────────┐
│                 API Server (Express 5)                   │
│              (artifacts/api-server)                      │
│                                                         │
│  Routes: calls · personas · bots · stats · config       │
│           memory · flow · email-agent · messaging        │
│           calendar · api-keys · health                   │
│                                                         │
│  Services: PersonaComposer · PersonaService             │
│            CallConnectService · Logger                   │
└───────────────────────────┬─────────────────────────────┘
                            │  Drizzle ORM
┌───────────────────────────▼─────────────────────────────┐
│                  PostgreSQL Database                     │
│  Tables: calls · bots · personas · persona_traits       │
│          persona_config · conversation_config · llm_config│
│          flow_configs · memory_entries · message_logs   │
│          calendar_invites · email_agent_config          │
│          writing_style_profiles                         │
└─────────────────────────────────────────────────────────┘
```

### Shared Libraries

| Package | Purpose |
|---------|---------|
| `@workspace/db` | Drizzle schema, migration runner, typed table exports |
| `@workspace/api-zod` | Zod schemas for all request/response shapes |
| `@workspace/api-client-react` | React Query hooks generated from the OpenAPI spec |

---

## 5. Feature Areas

### 5.1 Persona Engine

#### Overview
The Persona Engine is the core differentiation of VoxAgent. It allows operators to create named, versioned AI personas — each backed by structured trait data — and have those traits automatically translated into a voice-bot system prompt by the PersonaComposer service.

#### Requirements

**Persona Lifecycle**

| ID | Requirement |
|----|-------------|
| PE-01 | The system shall maintain a library of named personas, each with a unique name, description, source badge (Manual / Library / AI-Generated), version counter, and active flag. |
| PE-02 | At most one persona may be active at a time. Activating a persona deactivates all others atomically. |
| PE-03 | Activating a persona with empty `role_title`, `backstory`, or `goals` fields shall be rejected with HTTP 422 and a human-readable error message. |
| PE-04 | Personas may be duplicated; duplicates are assigned a new unique name and version 1. |
| PE-05 | Personas may be soft-deleted. Call records that reference a deleted persona shall display a "Deleted persona" label rather than a blank. |
| PE-06 | Five pre-seeded library personas shall be available at first launch (Hotel Receptionist, Hospital Appointment Desk, Bank Customer Care, E-commerce Order Support, Debt Collection Agent). |

**Trait Structure**

Persona traits are organised into five sections:

| Section | Fields |
|---------|--------|
| **Identity** | role_title, character, backstory, goals |
| **Language** | jargon (tags), greeting phrases, closing phrases, forbidden phrases, sample utterances |
| **Tone** | formality (1–10), verbosity (1–10), empathy (1–10), humor (1–10) |
| **Voice** | speaking pace, pitch, Deepgram voice hint, gender |
| **Behavior** | interrupt tolerance, silence strategy, escalation trigger, do-rules (tags), don't-rules (tags) |

| ID | Requirement |
|----|-------------|
| PE-07 | The trait editor shall provide sliders for all numeric tone fields (range 1–10). |
| PE-08 | Jargon, greeting/closing/forbidden phrases, rules, and sample utterances shall use a tag-style editor supporting add and remove operations. |
| PE-09 | Pace, pitch, interrupt tolerance, and silence strategy shall use dropdown selectors. |
| PE-10 | The editor shall track an unsaved-changes ("dirty") state, show a yellow indicator on the Edit Traits tab, display a browser `beforeunload` warning if the user closes the tab with unsaved changes, and show a confirm dialog before navigating away in-app. |

**AI-Powered Authoring**

| ID | Requirement |
|----|-------------|
| PE-11 | The "Generate Traits" flow shall accept a persona name and optional description, call the configured LLM with a 30-second timeout, and return a fully populated trait object. |
| PE-12 | The "Refine with AI" flow shall accept the current trait JSON and a plain-English instruction, call the LLM, and return updated traits for side-by-side diff review before the operator confirms the save. |
| PE-13 | LLM calls shall use the primary LLM engine with fallback to the configured fallback chain. All trait generation calls shall be logged with success/failure status. |
| PE-14 | If an LLM call exceeds 30 seconds or fails, a visible Retry button shall appear; the UI shall never display an infinite spinner. |

**Persona Test Chat**

| ID | Requirement |
|----|-------------|
| PE-15 | The Test Persona panel shall run 3–4 sample dialogue exchanges using the composed system prompt and display bot responses inline. |
| PE-16 | The composed system prompt (the full text the voice bot receives) shall be visible in the Test Persona panel. |

**PersonaComposer Service**

| ID | Requirement |
|----|-------------|
| PE-17 | The PersonaComposer service shall translate numeric tone values and all trait fields into structured, natural-language guidance sections (identity, language, tone, behavior, escalation). |
| PE-18 | The service shall export `validatePersonaForVoiceBot(traits)` returning `{ valid: boolean, issues: string[] }`. This function shall be called before activation and before inbound call stamping. |
| PE-19 | The composed prompt, persona ID, and persona name shall be snapshotted onto the call record at dial time and stored immutably — subsequent trait edits shall not alter the snapshot. |

---

### 5.2 Call Management

#### Overview
VoxAgent manages the full lifecycle of outbound and inbound telephone calls, persisting intelligence data on every interaction.

#### Requirements

**Call Record Schema**

Every call record contains:

| Field | Description |
|-------|-------------|
| `direction` | INBOUND or OUTBOUND |
| `status` | RINGING · IN_PROGRESS · COMPLETED · FAILED |
| `customerNumber` | E.164 phone number |
| `customerName` | Optional display name |
| `botId` | Originating/receiving bot |
| `personaId` | Persona active at call start |
| `composedPrompt` | Full system prompt snapshot |
| `connectOutcome` | AMD result: HUMAN · VOICEMAIL · IVR · NO_ANSWER |
| `languageDetected` | BCP-47 code |
| `duration` | Seconds |
| `hangupReason` | Who ended the call |
| `finalDisposition` | CRM outcome |
| `interruptionCount` | Customer barge-in events |
| `escalationCount` | Times escalation rule fired |
| `languageSwitches` | JSON array of switch events |
| `transcript` | Full turn-by-turn transcript |
| `summary` | AI-generated call summary |
| `recordingUrl` | URL of call recording |

**Outbound Calls**

| ID | Requirement |
|----|-------------|
| CL-01 | Operators shall initiate outbound calls by supplying a destination E.164 number and selecting a bot. |
| CL-02 | The active persona's traits shall be validated before dialling; invalid personas shall be rejected with an error shown in the UI. |
| CL-03 | AMD classification (Human / Voicemail / IVR / No Answer) shall be performed and stored on every outbound call. |
| CL-04 | Calling-hours rules configured on the bot shall be enforced; calls outside permitted hours shall be rejected. |

**Inbound Calls**

| ID | Requirement |
|----|-------------|
| CL-05 | The `POST /v1/calls/receive` webhook endpoint shall accept inbound telephony callbacks and create an INBOUND call record. |
| CL-06 | If an active persona exists and passes `validatePersonaForVoiceBot`, its ID and composed prompt shall be stamped onto the call record. |
| CL-07 | If no valid active persona exists, the call shall still be recorded; a warning shall be logged and the persona fields left null. |

**Call Operations**

| ID | Requirement |
|----|-------------|
| CL-08 | Operators shall be able to transfer a call to a specified destination from the Call Log. |
| CL-09 | Operators shall be able to initiate a conference on an active call. |
| CL-10 | Call records shall be deletable by administrators. |

**Call Log UI**

| ID | Requirement |
|----|-------------|
| CL-11 | The Call Log shall display direction, phone number, status badge, connect outcome, duration, disposition, language, persona name, and start time for each call. |
| CL-12 | Calls with status RINGING or IN_PROGRESS shall display a pulsing animated live indicator inside their status badge. |
| CL-13 | The persona name column shall show the persona name as snapshotted at call time. Calls made before persona stamping was introduced, and calls where no persona was active, shall display "—". Calls that used a since-deleted persona shall display "Deleted persona" with a muted label style. |
| CL-14 | Clicking a call row shall open a detail panel showing all call intelligence fields, transcript/summary, and a recording link. |
| CL-15 | The Call Log shall support filtering by direction (All / Inbound / Outbound) and status (All / Active / Completed / Failed) and refreshing on demand. |

---

### 5.3 Bot Network

#### Overview
The Bot Network module manages the fleet of voice-bot instances. Each bot is a configured telephony endpoint that can handle calls in one or both directions.

#### Requirements

| ID | Requirement |
|----|-------------|
| BN-01 | Each bot shall have a display name, direction (INBOUND / OUTBOUND / BOTH), SIP extension/domain, email address, and WhatsApp number. |
| BN-02 | Bots shall store supported languages and a default greeting language. |
| BN-03 | Bots shall store calling-hours rules (timezone, permitted windows) enforced at dial time. |
| BN-04 | Per-bot configuration shall include: answer delay (ms), barge-in threshold (ms), silence recovery (seconds), backchannel threshold (ms), AMD opening script, greeting script, max retries. |
| BN-05 | Per-bot escalation configuration shall include: escalation queue target and conversation-intelligence controls (escalation trigger sensitivity). |
| BN-06 | The Bot Network UI shall display each bot's status (ONLINE / OFFLINE / BUSY), active call count, and all configuration fields. |
| BN-07 | Operators shall be able to create, edit, and delete bots from the dashboard. |

---

### 5.4 Analytics Dashboard

#### Overview
The Analytics Dashboard provides a real-time overview of the voice-bot operation through KPI cards and interactive charts.

#### Requirements

**KPI Cards**

| ID | Requirement |
|----|-------------|
| DB-01 | The dashboard header shall display: Total Calls, Active Now, Completed Today, Success Rate (%), Average Duration, AMD Accuracy (%), Memory Hit Rate (%), and Bots Online count. |

**Charts**

| ID | Chart | Requirement |
|----|-------|-------------|
| DB-02 | Call Volume (24 h) | Hourly bar chart of call volume for the last 24 hours; bars coloured by direction. |
| DB-03 | Hangup Reasons | Horizontal bar chart showing the distribution of `hangupReason` values across all calls. |
| DB-04 | Connect Outcomes | Horizontal bar chart of AMD classification results (Human / Voicemail / IVR / No Answer). |
| DB-05 | Language Mix | Pie chart showing the percentage breakdown of `languageDetected` values across all calls. |
| DB-06 | Call Intelligence | Stat list showing: average interruptions per call, average escalations per call, barge-in rate (%), average language switches per call; computed across all stored call records. |

**Data Freshness**

| ID | Requirement |
|----|-------------|
| DB-07 | All dashboard data shall be fetched on mount and on manual Refresh. Polling is not required. |
| DB-08 | Charts with no data (e.g. Connect Outcomes before any AMD calls are made) shall display a "No data yet" placeholder rather than a blank or broken chart. |

---

### 5.5 Configuration & LLM Engine

#### Overview
The Configuration module provides system-wide defaults for persona voice style, conversation timing, and LLM provider settings.

#### Requirements

**Persona Configuration (Defaults)**

| ID | Requirement |
|----|-------------|
| CF-01 | The system shall persist a singleton persona-config record storing default character name, formality, verbosity, empathy, humor, speaking rate, pitch, voice ID, filler-word style, greeting style, and interrupt mode. |
| CF-02 | These defaults are applied when no active persona overrides the field. |

**Conversation Configuration**

| ID | Requirement |
|----|-------------|
| CF-03 | The system shall persist a singleton conversation-config record storing: answer delay (ms), max silence (ms), barge-in enabled flag, barge-in threshold (ms), minimum speech duration (ms), end-of-utterance gap (ms), max turn duration (ms), response timeout (ms), speaking rate, inter-word pause (ms). |
| CF-04 | All conversation-config fields shall be editable via sliders and number inputs in the Configuration tab and saved via a single Save button. |

**LLM Engine Configuration**

| ID | Requirement |
|----|-------------|
| CF-05 | The system shall persist a singleton LLM-config record storing: primary LLM engine (model name), fallback chain (ordered list of model names), per-call timeout (seconds), max retries, circuit-breaker failure threshold, and circuit-breaker recovery timeout. |
| CF-06 | LLM config changes shall take effect on the next LLM call; no server restart is required. |

**API Key Management**

| ID | Requirement |
|----|-------------|
| CF-07 | The API Keys tab shall list all third-party service integrations (e.g. Microsoft Graph, telephony provider, LLM provider). |
| CF-08 | For each integration, the UI shall show: service name, connection status, and a masked key indicator. |
| CF-09 | Operators shall be able to trigger a connectivity test per service; the result (success / error message) shall be displayed inline. |

---

### 5.6 Knowledge Base & Memory

#### Overview
The Memory module stores a curated set of Q&A pairs that the voice bot can draw on during calls, reducing hallucination and improving answer accuracy.

#### Requirements

| ID | Requirement |
|----|-------------|
| KB-01 | Memory entries shall each store a question, an answer, a confidence score, a tier (e.g. high / medium / low), a hit count, and a last-accessed timestamp. |
| KB-02 | Operators shall be able to create, edit, and delete memory entries via the dashboard. |
| KB-03 | A "Train" action shall submit the current memory corpus to the LLM for embedding/indexing. |
| KB-04 | The Memory Stats panel shall show total entries, hit rate, and last training timestamp. |
| KB-05 | The dashboard shall display the overall Memory Hit Rate KPI (percentage of calls where at least one memory entry was retrieved). |

---

### 5.7 Flow Builder

#### Overview
The Flow Builder allows operators to define visual conversation workflows — structured branching logic layered on top of the persona system.

#### Requirements

| ID | Requirement |
|----|-------------|
| FB-01 | Flow configs shall be stored as named, described JSON documents containing a `nodes` array and an `edges` array (directed graph). |
| FB-02 | Multiple flow configs may exist; operators may create, view, update, and delete configs. |
| FB-03 | The Flow Builder UI shall render the node/edge definition as a visual canvas with drag-and-drop editing. |
| FB-04 | The active flow config, if set, shall be applied on top of the active persona's system prompt during call setup. |

---

### 5.8 Email Agent

#### Overview
The Email Agent connects VoxAgent to a Microsoft Graph mailbox, allowing the bot to send call summaries, handle inbound email, and learn the operator's writing style.

#### Requirements

**Configuration**

| ID | Requirement |
|----|-------------|
| EA-01 | The Email Agent shall store a singleton config: Microsoft Azure tenant ID, client ID, client secret (encrypted at rest), mailbox user email, and enabled flag. |
| EA-02 | Operators shall be able to test the connection and see a success/failure status. |

**Inbox**

| ID | Requirement |
|----|-------------|
| EA-03 | The Email Agent tab shall display the mailbox inbox with threaded message view. |
| EA-04 | Operators shall be able to reply to email threads directly from the dashboard. |
| EA-05 | Operators shall be able to send a call summary email for a selected call, choosing the recipient address. |

**Writing Style**

| ID | Requirement |
|----|-------------|
| EA-06 | The system shall store a writing style profile: greeting style, sign-off phrase, tone, call-summary template, style examples, and learned patterns. |
| EA-07 | The "Learn Style" feature shall analyse existing email examples and update the learned patterns. |
| EA-08 | All outbound emails generated by the system (summaries, replies) shall use the learned writing style. |

---

### 5.9 Messaging Hub

#### Overview
The Messaging Hub provides a unified interface for sending messages across channels and viewing the message delivery log.

#### Requirements

| ID | Requirement |
|----|-------------|
| MH-01 | Operators shall be able to send messages via WhatsApp, Telegram, and Email from the dashboard. |
| MH-02 | Every sent message shall be logged with: channel, recipient, template name (if applicable), provider message ID, delivery status, and associated call ID. |
| MH-03 | The Messaging Hub UI shall display the full message log with channel icons and delivery status badges. |
| MH-04 | The voice bot shall be able to trigger outbound messages (e.g. post-call follow-up) via the messaging API. |

---

### 5.10 Calendar & Scheduling

#### Overview
The Calendar module allows the voice bot and operators to schedule follow-up appointments during or after a call.

#### Requirements

| ID | Requirement |
|----|-------------|
| CA-01 | The system shall support creating calendar invites with: title, description, start time, end time, timezone, attendee list, location, and Google Meet link. |
| CA-02 | Every calendar invite shall be linked to the originating call record via `callId`. |
| CA-03 | The `POST /v1/calendar/invite` endpoint shall return the calendar event ID from the upstream calendar provider. |
| CA-04 | The `GET /v1/calendar/slots` endpoint shall return available time slots for scheduling purposes. |

---

### 5.11 Mobile Application

#### Overview
The VoxAgent mobile app (iOS & Android, built with Expo React Native) gives field operators and managers a portable view of the call operation.

#### Requirements

**Dashboard Tab**

| ID | Requirement |
|----|-------------|
| MB-01 | The Dashboard tab shall display the same KPI cards as the web dashboard: Total Calls, Active Now, Completed Today, Success Rate, Avg Duration, AMD Accuracy, Memory Hit Rate, Bots Online. |

**Calls Tab**

| ID | Requirement |
|----|-------------|
| MB-02 | The Calls tab shall show a scrollable call list ordered by recency. |
| MB-03 | Each row shall display: direction indicator, phone number, customer name (if available), status badge, duration, and persona name. |
| MB-04 | A Filter Bar shall provide: direction chips (All / Inbound / Outbound), status chips (All / Live / Done / Failed), and a search field matching on caller name, number, or persona name. All filters shall be applied client-side. |
| MB-05 | Tapping a call row shall open a full-screen Call Detail modal containing: all call intelligence fields, transcript/summary section, and a "Play Recording" button that opens the recording URL. |
| MB-06 | The call list shall be refreshable via pull-to-refresh. |

**Personas Tab**

| ID | Requirement |
|----|-------------|
| MB-07 | The Personas tab shall list all personas with name, source badge, and active indicator. |
| MB-08 | Tapping a persona shall show a read-only trait summary. |

**Summary Tab**

| ID | Requirement |
|----|-------------|
| MB-09 | The Summary tab shall allow the operator to select a recent call and trigger the Email Agent to send a call summary to a specified recipient. |
| MB-10 | The tab shall display the generated summary text and the send status. |

---

## 6. Data Model Summary

| Table | Purpose | Key Relationships |
|-------|---------|-------------------|
| `calls` | One row per call, full intelligence payload | FK → `bots.id`, FK → `personas.id` |
| `bots` | Voice-bot instance configuration | Referenced by `calls.botId` |
| `personas` | Named persona versions | Has-many `persona_traits` |
| `persona_traits` | Versioned trait JSON per persona | FK → `personas.id` (cascade delete) |
| `persona_config` | Singleton default persona voice/style settings | — |
| `conversation_config` | Singleton conversation timing parameters | — |
| `llm_config` | Singleton LLM provider and circuit-breaker config | — |
| `flow_configs` | Named conversation flow definitions | — |
| `memory_entries` | Q&A knowledge base entries | — |
| `message_logs` | Outbound message delivery records | FK → `calls.id` (optional) |
| `calendar_invites` | Scheduled appointments | FK → `calls.id` (optional) |
| `email_agent_config` | Microsoft Graph mailbox credentials | — |
| `writing_style_profiles` | Learned email writing style | — |

---

## 7. API Surface

All endpoints are prefixed `/api` in the development proxy and served at `/v1/...` by the API server.

| Module | Method | Path | Description |
|--------|--------|------|-------------|
| Health | GET | `/v1/health` | Service health check |
| Calls | GET | `/v1/calls` | List calls (paginated) |
| | POST | `/v1/calls/dial` | Initiate outbound call |
| | POST | `/v1/calls/receive` | Inbound telephony webhook |
| | POST | `/v1/calls/inbound` | Create inbound call record |
| | GET | `/v1/calls/:id` | Call detail |
| | DELETE | `/v1/calls/:id` | Delete call |
| | POST | `/v1/calls/:id/transfer` | Transfer call |
| | POST | `/v1/calls/:id/conference` | Conference call |
| Personas | GET | `/v1/personas` | List personas |
| | POST | `/v1/personas` | Create persona |
| | GET | `/v1/personas/:id` | Persona detail |
| | PUT | `/v1/personas/:id/traits` | Update traits |
| | POST | `/v1/personas/:id/activate` | Activate persona |
| | POST | `/v1/personas/:id/regenerate` | AI-regenerate traits |
| | POST | `/v1/personas/:id/refine` | AI-refine traits |
| | POST | `/v1/personas/:id/test` | Test persona chat |
| | POST | `/v1/personas/:id/duplicate` | Duplicate persona |
| | DELETE | `/v1/personas/:id` | Delete persona |
| | GET | `/v1/personas/active/compose` | Get composed active prompt |
| Stats | GET | `/v1/stats/overview` | KPI card data |
| | GET | `/v1/stats/calls-by-hour` | 24-hour call volume |
| | GET | `/v1/stats/hangup-reasons` | Hangup reason distribution |
| | GET | `/v1/stats/connect-outcomes` | AMD outcome distribution |
| | GET | `/v1/stats/language-mix` | Language distribution |
| | GET | `/v1/stats/call-intelligence` | Interruption/escalation/barge-in stats |
| Bots | GET | `/v1/bots` | List bots |
| | POST | `/v1/bots` | Create bot |
| | GET | `/v1/bots/:id` | Bot detail |
| | PATCH | `/v1/bots/:id` | Update bot |
| | DELETE | `/v1/bots/:id` | Delete bot |
| Config | GET/PUT | `/v1/config/persona` | Persona defaults |
| | GET/PUT | `/v1/config/conversation` | Conversation timing |
| | GET/PUT | `/v1/config/llm` | LLM engine settings |
| | GET | `/v1/config/api-keys` | API key status |
| | POST | `/v1/config/api-keys/:service/test` | Test API key connectivity |
| Memory | GET | `/v1/memory/entries` | List memory entries |
| | POST | `/v1/memory/entries` | Create entry |
| | PUT | `/v1/memory/entries/:id` | Update entry |
| | DELETE | `/v1/memory/entries/:id` | Delete entry |
| | GET | `/v1/memory/stats` | Memory statistics |
| | POST | `/v1/memory/train` | Trigger training |
| Flow | GET | `/v1/flow/configs` | List flow configs |
| | POST | `/v1/flow/configs` | Create flow config |
| | GET | `/v1/flow/configs/:id` | Get flow config |
| | PUT | `/v1/flow/configs/:id` | Update flow config |
| | DELETE | `/v1/flow/configs/:id` | Delete flow config |
| Email Agent | GET/PUT | `/v1/email-agent/config` | Email agent config |
| | POST | `/v1/email-agent/test-connection` | Test mailbox connection |
| | GET | `/v1/email-agent/inbox` | Inbox messages |
| | GET | `/v1/email-agent/message/:id` | Message detail |
| | GET | `/v1/email-agent/thread/:id` | Thread view |
| | POST | `/v1/email-agent/reply` | Reply to thread |
| | POST | `/v1/email-agent/send-summary` | Send call summary email |
| | GET/PUT | `/v1/email-agent/style` | Writing style profile |
| | POST | `/v1/email-agent/learn-style` | Learn from examples |
| Messaging | POST | `/v1/messaging/whatsapp` | Send WhatsApp |
| | POST | `/v1/messaging/telegram` | Send Telegram |
| | POST | `/v1/messaging/email` | Send email |
| | GET | `/v1/messaging/logs` | Message delivery log |
| Calendar | POST | `/v1/calendar/invite` | Create calendar invite |
| | GET | `/v1/calendar/slots` | Get available slots |

---

## 8. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Performance** | API endpoints shall respond in < 500 ms under normal load for all non-LLM routes. LLM routes shall complete within 30 seconds or return a timeout error. |
| **Availability** | The API server shall expose a `/v1/health` endpoint for health monitoring. |
| **Data Integrity** | Persona traits are versioned; deleting a persona cascades to persona_traits but call records retain the `composedPrompt` snapshot. |
| **Security** | API keys stored in the DB shall be masked in all GET responses (only status, not the key value). The SESSION_SECRET environment variable shall be used for session signing and never logged. |
| **Logging** | All requests shall be logged via structured Pino logging (method, path, status, response time). |
| **Resilience** | The LLM engine shall implement a configurable circuit breaker: after N consecutive failures, requests are short-circuited until the recovery timeout elapses. |
| **Extensibility** | LLM provider is configurable; swapping the primary model requires only a config change, not a code deployment. |
| **Mobile** | The mobile app shall function on iOS 16+ and Android 12+ via Expo managed workflow. |

---

## 9. Constraints & Assumptions

| # | Statement |
|---|-----------|
| C1 | The system is single-tenant in v1.0. Multi-tenancy is out of scope. |
| C2 | Real-time TTS playback of persona voice in the browser is out of scope for v1.0. |
| C3 | Per-bot persona assignment is out of scope; persona is system-wide. |
| C4 | Multi-language persona profiles (separate trait sets per language) are out of scope for v1.0. |
| C5 | The telephony transport layer (SIP, carrier integration) is assumed to be provided by the operator's existing infrastructure; VoxAgent manages the logical call state via webhooks and API calls. |
| C6 | Calendar integration assumes Google Calendar (Meet link generation); Microsoft 365 calendar is a future integration. |
| C7 | Email integration requires a Microsoft Azure application registration with delegated Graph API permissions. |
| C8 | All timestamps are stored and returned in UTC. |

---

## 10. Glossary

| Term | Definition |
|------|-----------|
| **AMD** | Answering Machine Detection — classifying whether a picked-up call was answered by a human, voicemail, IVR, or not answered. |
| **Barge-in** | The act of a customer speaking while the bot is talking, interrupting the bot's current utterance. |
| **Composed Prompt** | The full system-prompt string generated by PersonaComposer from a persona's trait data, snapshotted at call start. |
| **Connect Outcome** | The result of AMD: one of HUMAN, VOICEMAIL, IVR, NO_ANSWER. |
| **Disposition** | The CRM-level outcome of a call (e.g. TRANSFERRED, BOT_HUNGUP, CUSTOMER_HANGUP). |
| **Escalation** | A moment in a call where the bot determines the conversation should be routed to a human agent. |
| **Fallback Chain** | An ordered list of LLM models to try if the primary model fails or times out. |
| **Memory Hit** | A call during which at least one memory entry was retrieved and used to answer a customer question. |
| **Persona** | A named, versioned AI persona with structured traits that determine the voice bot's identity, language, tone, voice, and behaviour. |
| **PersonaComposer** | The backend service module that translates persona traits into a natural-language system prompt. |
| **SIP** | Session Initiation Protocol — the telephony signalling protocol used for VoIP call setup. |
| **Trait** | A single configurable attribute of a persona (e.g. formality score, jargon tags, escalation trigger). |
| **Voice Bot** | The AI agent that conducts telephone conversations on behalf of the operator using a configured persona and system prompt. |

---

*End of Document*
# VoxAgent — Business Requirements Document

**Version:** 1.0  
**Date:** August 12, 2026  
**Status:** Final  
**Prepared by:** VoxAgent Product Team

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Vision & Goals](#2-product-vision--goals)
3. [Stakeholders](#3-stakeholders)
4. [System Architecture Overview](#4-system-architecture-overview)
5. [Feature Areas](#5-feature-areas)
   - 5.1 [Persona Engine](#51-persona-engine)
   - 5.2 [Call Management](#52-call-management)
   - 5.3 [Bot Network](#53-bot-network)
   - 5.4 [Analytics Dashboard](#54-analytics-dashboard)
   - 5.5 [Configuration & LLM Engine](#55-configuration--llm-engine)
   - 5.6 [Knowledge Base & Memory](#56-knowledge-base--memory)
   - 5.7 [Flow Builder](#57-flow-builder)
   - 5.8 [Email Agent](#58-email-agent)
   - 5.9 [Messaging Hub](#59-messaging-hub)
   - 5.10 [Calendar & Scheduling](#510-calendar--scheduling)
   - 5.11 [Mobile Application](#511-mobile-application)
6. [Data Model Summary](#6-data-model-summary)
7. [API Surface](#7-api-surface)
8. [Non-Functional Requirements](#8-non-functional-requirements)
9. [Constraints & Assumptions](#9-constraints--assumptions)
10. [Glossary](#10-glossary)

---

## 1. Executive Summary

VoxAgent is an enterprise AI voice-bot control plane that enables organisations to deploy, configure, monitor, and continuously improve AI-powered telephone agents. The platform allows operators to:

- Define rich voice-bot personas backed by structured trait data and AI-generated system prompts.
- Initiate and receive telephone calls through a managed bot fleet.
- Monitor call analytics, transcripts, recordings, and intelligence metrics in real time.
- Orchestrate post-call workflows including email summaries, calendar invites, and CRM disposition.
- Control the entire system from a web dashboard or a companion mobile application.

VoxAgent is delivered as a monorepo consisting of an Express API server, a React/Vite web dashboard, an Expo React Native mobile app, and shared TypeScript libraries for the database schema, API client, and Zod validation schemas.

---

## 2. Product Vision & Goals

### Vision
Give any organisation the ability to deploy a human-quality AI telephone agent in hours — not months — and continuously refine it without engineering support.

### Primary Goals

| # | Goal | Measure of Success |
|---|------|-------------------|
| G1 | Reduce time-to-deploy a new voice persona | < 30 min from first login to first live call |
| G2 | Ensure system-prompt integrity across persona edits | Composed prompt snapshotted on every call record |
| G3 | Block misconfigured personas from reaching customers | Activate endpoint enforces identity-field validation (HTTP 422 on failure) |
| G4 | Give operators full call intelligence on every interaction | AMD rate, language mix, barge-in, escalation, transcript available per call |
| G5 | Enable monitoring from a mobile device | Full call detail, filters, and recordings accessible on iOS/Android |
| G6 | Support post-call operational workflows | Summary emails, calendar invites, and CRM disposition sent automatically |

---

## 3. Stakeholders

| Role | Responsibility |
|------|----------------|
| **Contact Centre Manager** | Configures bots, personas, and calling hours; reviews analytics |
| **AI/Prompt Engineer** | Authors and refines persona traits; uses AI regenerate and refine flows |
| **Operations Supervisor** | Monitors live and historical calls; dispatches transfers; reviews recordings |
| **Mobile Field Operator** | Reviews call activity and transcripts on the companion mobile app |
| **IT Administrator** | Manages API keys, LLM provider config, SIP/WhatsApp integration credentials |
| **VoxAgent Platform Team** | Develops and maintains the product |

---

## 4. System Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Client Layer                         │
│  React/Vite Dashboard          Expo Mobile App          │
│  (artifacts/dashboard)         (artifacts/mobile)       │
└───────────────────┬─────────────────────┬───────────────┘
                    │  REST + JSON         │
┌───────────────────▼─────────────────────▼───────────────┐
│                 API Server (Express 5)                   │
│              (artifacts/api-server)                      │
│                                                         │
│  Routes: calls · personas · bots · stats · config       │
│           memory · flow · email-agent · messaging        │
│           calendar · api-keys · health                   │
│                                                         │
│  Services: PersonaComposer · PersonaService             │
│            CallConnectService · Logger                   │
└───────────────────────────┬─────────────────────────────┘
                            │  Drizzle ORM
┌───────────────────────────▼─────────────────────────────┐
│                  PostgreSQL Database                     │
│  Tables: calls · bots · personas · persona_traits       │
│          persona_config · conversation_config · llm_config│
│          flow_configs · memory_entries · message_logs   │
│          calendar_invites · email_agent_config          │
│          writing_style_profiles                         │
└─────────────────────────────────────────────────────────┘
```

### Shared Libraries

| Package | Purpose |
|---------|---------|
| `@workspace/db` | Drizzle schema, migration runner, typed table exports |
| `@workspace/api-zod` | Zod schemas for all request/response shapes |
| `@workspace/api-client-react` | React Query hooks generated from the OpenAPI spec |

---

## 5. Feature Areas

### 5.1 Persona Engine

#### Overview
The Persona Engine is the core differentiation of VoxAgent. It allows operators to create named, versioned AI personas — each backed by structured trait data — and have those traits automatically translated into a voice-bot system prompt by the PersonaComposer service.

#### Requirements

**Persona Lifecycle**

| ID | Requirement |
|----|-------------|
| PE-01 | The system shall maintain a library of named personas, each with a unique name, description, source badge (Manual / Library / AI-Generated), version counter, and active flag. |
| PE-02 | At most one persona may be active at a time. Activating a persona deactivates all others atomically. |
| PE-03 | Activating a persona with empty `role_title`, `backstory`, or `goals` fields shall be rejected with HTTP 422 and a human-readable error message. |
| PE-04 | Personas may be duplicated; duplicates are assigned a new unique name and version 1. |
| PE-05 | Personas may be soft-deleted. Call records that reference a deleted persona shall display a "Deleted persona" label rather than a blank. |
| PE-06 | Five pre-seeded library personas shall be available at first launch (Hotel Receptionist, Hospital Appointment Desk, Bank Customer Care, E-commerce Order Support, Debt Collection Agent). |

**Trait Structure**

Persona traits are organised into five sections:

| Section | Fields |
|---------|--------|
| **Identity** | role_title, character, backstory, goals |
| **Language** | jargon (tags), greeting phrases, closing phrases, forbidden phrases, sample utterances |
| **Tone** | formality (1–10), verbosity (1–10), empathy (1–10), humor (1–10) |
| **Voice** | speaking pace, pitch, Deepgram voice hint, gender |
| **Behavior** | interrupt tolerance, silence strategy, escalation trigger, do-rules (tags), don't-rules (tags) |

| ID | Requirement |
|----|-------------|
| PE-07 | The trait editor shall provide sliders for all numeric tone fields (range 1–10). |
| PE-08 | Jargon, greeting/closing/forbidden phrases, rules, and sample utterances shall use a tag-style editor supporting add and remove operations. |
| PE-09 | Pace, pitch, interrupt tolerance, and silence strategy shall use dropdown selectors. |
| PE-10 | The editor shall track an unsaved-changes ("dirty") state, show a yellow indicator on the Edit Traits tab, display a browser `beforeunload` warning if the user closes the tab with unsaved changes, and show a confirm dialog before navigating away in-app. |

**AI-Powered Authoring**

| ID | Requirement |
|----|-------------|
| PE-11 | The "Generate Traits" flow shall accept a persona name and optional description, call the configured LLM with a 30-second timeout, and return a fully populated trait object. |
| PE-12 | The "Refine with AI" flow shall accept the current trait JSON and a plain-English instruction, call the LLM, and return updated traits for side-by-side diff review before the operator confirms the save. |
| PE-13 | LLM calls shall use the primary LLM engine with fallback to the configured fallback chain. All trait generation calls shall be logged with success/failure status. |
| PE-14 | If an LLM call exceeds 30 seconds or fails, a visible Retry button shall appear; the UI shall never display an infinite spinner. |

**Persona Test Chat**

| ID | Requirement |
|----|-------------|
| PE-15 | The Test Persona panel shall run 3–4 sample dialogue exchanges using the composed system prompt and display bot responses inline. |
| PE-16 | The composed system prompt (the full text the voice bot receives) shall be visible in the Test Persona panel. |

**PersonaComposer Service**

| ID | Requirement |
|----|-------------|
| PE-17 | The PersonaComposer service shall translate numeric tone values and all trait fields into structured, natural-language guidance sections (identity, language, tone, behavior, escalation). |
| PE-18 | The service shall export `validatePersonaForVoiceBot(traits)` returning `{ valid: boolean, issues: string[] }`. This function shall be called before activation and before inbound call stamping. |
| PE-19 | The composed prompt, persona ID, and persona name shall be snapshotted onto the call record at dial time and stored immutably — subsequent trait edits shall not alter the snapshot. |

---

### 5.2 Call Management

#### Overview
VoxAgent manages the full lifecycle of outbound and inbound telephone calls, persisting intelligence data on every interaction.

#### Requirements

**Call Record Schema**

Every call record contains:

| Field | Description |
|-------|-------------|
| `direction` | INBOUND or OUTBOUND |
| `status` | RINGING · IN_PROGRESS · COMPLETED · FAILED |
| `customerNumber` | E.164 phone number |
| `customerName` | Optional display name |
| `botId` | Originating/receiving bot |
| `personaId` | Persona active at call start |
| `composedPrompt` | Full system prompt snapshot |
| `connectOutcome` | AMD result: HUMAN · VOICEMAIL · IVR · NO_ANSWER |
| `languageDetected` | BCP-47 code |
| `duration` | Seconds |
| `hangupReason` | Who ended the call |
| `finalDisposition` | CRM outcome |
| `interruptionCount` | Customer barge-in events |
| `escalationCount` | Times escalation rule fired |
| `languageSwitches` | JSON array of switch events |
| `transcript` | Full turn-by-turn transcript |
| `summary` | AI-generated call summary |
| `recordingUrl` | URL of call recording |

**Outbound Calls**

| ID | Requirement |
|----|-------------|
| CL-01 | Operators shall initiate outbound calls by supplying a destination E.164 number and selecting a bot. |
| CL-02 | The active persona's traits shall be validated before dialling; invalid personas shall be rejected with an error shown in the UI. |
| CL-03 | AMD classification (Human / Voicemail / IVR / No Answer) shall be performed and stored on every outbound call. |
| CL-04 | Calling-hours rules configured on the bot shall be enforced; calls outside permitted hours shall be rejected. |

**Inbound Calls**

| ID | Requirement |
|----|-------------|
| CL-05 | The `POST /v1/calls/receive` webhook endpoint shall accept inbound telephony callbacks and create an INBOUND call record. |
| CL-06 | If an active persona exists and passes `validatePersonaForVoiceBot`, its ID and composed prompt shall be stamped onto the call record. |
| CL-07 | If no valid active persona exists, the call shall still be recorded; a warning shall be logged and the persona fields left null. |

**Call Operations**

| ID | Requirement |
|----|-------------|
| CL-08 | Operators shall be able to transfer a call to a specified destination from the Call Log. |
| CL-09 | Operators shall be able to initiate a conference on an active call. |
| CL-10 | Call records shall be deletable by administrators. |

**Call Log UI**

| ID | Requirement |
|----|-------------|
| CL-11 | The Call Log shall display direction, phone number, status badge, connect outcome, duration, disposition, language, persona name, and start time for each call. |
| CL-12 | Calls with status RINGING or IN_PROGRESS shall display a pulsing animated live indicator inside their status badge. |
| CL-13 | The persona name column shall show the persona name as snapshotted at call time. Calls made before persona stamping was introduced, and calls where no persona was active, shall display "—". Calls that used a since-deleted persona shall display "Deleted persona" with a muted label style. |
| CL-14 | Clicking a call row shall open a detail panel showing all call intelligence fields, transcript/summary, and a recording link. |
| CL-15 | The Call Log shall support filtering by direction (All / Inbound / Outbound) and status (All / Active / Completed / Failed) and refreshing on demand. |

---

### 5.3 Bot Network

#### Overview
The Bot Network module manages the fleet of voice-bot instances. Each bot is a configured telephony endpoint that can handle calls in one or both directions.

#### Requirements

| ID | Requirement |
|----|-------------|
| BN-01 | Each bot shall have a display name, direction (INBOUND / OUTBOUND / BOTH), SIP extension/domain, email address, and WhatsApp number. |
| BN-02 | Bots shall store supported languages and a default greeting language. |
| BN-03 | Bots shall store calling-hours rules (timezone, permitted windows) enforced at dial time. |
| BN-04 | Per-bot configuration shall include: answer delay (ms), barge-in threshold (ms), silence recovery (seconds), backchannel threshold (ms), AMD opening script, greeting script, max retries. |
| BN-05 | Per-bot escalation configuration shall include: escalation queue target and conversation-intelligence controls (escalation trigger sensitivity). |
| BN-06 | The Bot Network UI shall display each bot's status (ONLINE / OFFLINE / BUSY), active call count, and all configuration fields. |
| BN-07 | Operators shall be able to create, edit, and delete bots from the dashboard. |

---

### 5.4 Analytics Dashboard

#### Overview
The Analytics Dashboard provides a real-time overview of the voice-bot operation through KPI cards and interactive charts.

#### Requirements

**KPI Cards**

| ID | Requirement |
|----|-------------|
| DB-01 | The dashboard header shall display: Total Calls, Active Now, Completed Today, Success Rate (%), Average Duration, AMD Accuracy (%), Memory Hit Rate (%), and Bots Online count. |

**Charts**

| ID | Chart | Requirement |
|----|-------|-------------|
| DB-02 | Call Volume (24 h) | Hourly bar chart of call volume for the last 24 hours; bars coloured by direction. |
| DB-03 | Hangup Reasons | Horizontal bar chart showing the distribution of `hangupReason` values across all calls. |
| DB-04 | Connect Outcomes | Horizontal bar chart of AMD classification results (Human / Voicemail / IVR / No Answer). |
| DB-05 | Language Mix | Pie chart showing the percentage breakdown of `languageDetected` values across all calls. |
| DB-06 | Call Intelligence | Stat list showing: average interruptions per call, average escalations per call, barge-in rate (%), average language switches per call; computed across all stored call records. |

**Data Freshness**

| ID | Requirement |
|----|-------------|
| DB-07 | All dashboard data shall be fetched on mount and on manual Refresh. Polling is not required. |
| DB-08 | Charts with no data (e.g. Connect Outcomes before any AMD calls are made) shall display a "No data yet" placeholder rather than a blank or broken chart. |

---

### 5.5 Configuration & LLM Engine

#### Overview
The Configuration module provides system-wide defaults for persona voice style, conversation timing, and LLM provider settings.

#### Requirements

**Persona Configuration (Defaults)**

| ID | Requirement |
|----|-------------|
| CF-01 | The system shall persist a singleton persona-config record storing default character name, formality, verbosity, empathy, humor, speaking rate, pitch, voice ID, filler-word style, greeting style, and interrupt mode. |
| CF-02 | These defaults are applied when no active persona overrides the field. |

**Conversation Configuration**

| ID | Requirement |
|----|-------------|
| CF-03 | The system shall persist a singleton conversation-config record storing: answer delay (ms), max silence (ms), barge-in enabled flag, barge-in threshold (ms), minimum speech duration (ms), end-of-utterance gap (ms), max turn duration (ms), response timeout (ms), speaking rate, inter-word pause (ms). |
| CF-04 | All conversation-config fields shall be editable via sliders and number inputs in the Configuration tab and saved via a single Save button. |

**LLM Engine Configuration**

| ID | Requirement |
|----|-------------|
| CF-05 | The system shall persist a singleton LLM-config record storing: primary LLM engine (model name), fallback chain (ordered list of model names), per-call timeout (seconds), max retries, circuit-breaker failure threshold, and circuit-breaker recovery timeout. |
| CF-06 | LLM config changes shall take effect on the next LLM call; no server restart is required. |

**API Key Management**

| ID | Requirement |
|----|-------------|
| CF-07 | The API Keys tab shall list all third-party service integrations (e.g. Microsoft Graph, telephony provider, LLM provider). |
| CF-08 | For each integration, the UI shall show: service name, connection status, and a masked key indicator. |
| CF-09 | Operators shall be able to trigger a connectivity test per service; the result (success / error message) shall be displayed inline. |

---

### 5.6 Knowledge Base & Memory

#### Overview
The Memory module stores a curated set of Q&A pairs that the voice bot can draw on during calls, reducing hallucination and improving answer accuracy.

#### Requirements

| ID | Requirement |
|----|-------------|
| KB-01 | Memory entries shall each store a question, an answer, a confidence score, a tier (e.g. high / medium / low), a hit count, and a last-accessed timestamp. |
| KB-02 | Operators shall be able to create, edit, and delete memory entries via the dashboard. |
| KB-03 | A "Train" action shall submit the current memory corpus to the LLM for embedding/indexing. |
| KB-04 | The Memory Stats panel shall show total entries, hit rate, and last training timestamp. |
| KB-05 | The dashboard shall display the overall Memory Hit Rate KPI (percentage of calls where at least one memory entry was retrieved). |

---

### 5.7 Flow Builder

#### Overview
The Flow Builder allows operators to define visual conversation workflows — structured branching logic layered on top of the persona system.

#### Requirements

| ID | Requirement |
|----|-------------|
| FB-01 | Flow configs shall be stored as named, described JSON documents containing a `nodes` array and an `edges` array (directed graph). |
| FB-02 | Multiple flow configs may exist; operators may create, view, update, and delete configs. |
| FB-03 | The Flow Builder UI shall render the node/edge definition as a visual canvas with drag-and-drop editing. |
| FB-04 | The active flow config, if set, shall be applied on top of the active persona's system prompt during call setup. |

---

### 5.8 Email Agent

#### Overview
The Email Agent connects VoxAgent to a Microsoft Graph mailbox, allowing the bot to send call summaries, handle inbound email, and learn the operator's writing style.

#### Requirements

**Configuration**

| ID | Requirement |
|----|-------------|
| EA-01 | The Email Agent shall store a singleton config: Microsoft Azure tenant ID, client ID, client secret (encrypted at rest), mailbox user email, and enabled flag. |
| EA-02 | Operators shall be able to test the connection and see a success/failure status. |

**Inbox**

| ID | Requirement |
|----|-------------|
| EA-03 | The Email Agent tab shall display the mailbox inbox with threaded message view. |
| EA-04 | Operators shall be able to reply to email threads directly from the dashboard. |
| EA-05 | Operators shall be able to send a call summary email for a selected call, choosing the recipient address. |

**Writing Style**

| ID | Requirement |
|----|-------------|
| EA-06 | The system shall store a writing style profile: greeting style, sign-off phrase, tone, call-summary template, style examples, and learned patterns. |
| EA-07 | The "Learn Style" feature shall analyse existing email examples and update the learned patterns. |
| EA-08 | All outbound emails generated by the system (summaries, replies) shall use the learned writing style. |

---

### 5.9 Messaging Hub

#### Overview
The Messaging Hub provides a unified interface for sending messages across channels and viewing the message delivery log.

#### Requirements

| ID | Requirement |
|----|-------------|
| MH-01 | Operators shall be able to send messages via WhatsApp, Telegram, and Email from the dashboard. |
| MH-02 | Every sent message shall be logged with: channel, recipient, template name (if applicable), provider message ID, delivery status, and associated call ID. |
| MH-03 | The Messaging Hub UI shall display the full message log with channel icons and delivery status badges. |
| MH-04 | The voice bot shall be able to trigger outbound messages (e.g. post-call follow-up) via the messaging API. |

---

### 5.10 Calendar & Scheduling

#### Overview
The Calendar module allows the voice bot and operators to schedule follow-up appointments during or after a call.

#### Requirements

| ID | Requirement |
|----|-------------|
| CA-01 | The system shall support creating calendar invites with: title, description, start time, end time, timezone, attendee list, location, and Google Meet link. |
| CA-02 | Every calendar invite shall be linked to the originating call record via `callId`. |
| CA-03 | The `POST /v1/calendar/invite` endpoint shall return the calendar event ID from the upstream calendar provider. |
| CA-04 | The `GET /v1/calendar/slots` endpoint shall return available time slots for scheduling purposes. |

---

### 5.11 Mobile Application

#### Overview
The VoxAgent mobile app (iOS & Android, built with Expo React Native) gives field operators and managers a portable view of the call operation.

#### Requirements

**Dashboard Tab**

| ID | Requirement |
|----|-------------|
| MB-01 | The Dashboard tab shall display the same KPI cards as the web dashboard: Total Calls, Active Now, Completed Today, Success Rate, Avg Duration, AMD Accuracy, Memory Hit Rate, Bots Online. |

**Calls Tab**

| ID | Requirement |
|----|-------------|
| MB-02 | The Calls tab shall show a scrollable call list ordered by recency. |
| MB-03 | Each row shall display: direction indicator, phone number, customer name (if available), status badge, duration, and persona name. |
| MB-04 | A Filter Bar shall provide: direction chips (All / Inbound / Outbound), status chips (All / Live / Done / Failed), and a search field matching on caller name, number, or persona name. All filters shall be applied client-side. |
| MB-05 | Tapping a call row shall open a full-screen Call Detail modal containing: all call intelligence fields, transcript/summary section, and a "Play Recording" button that opens the recording URL. |
| MB-06 | The call list shall be refreshable via pull-to-refresh. |

**Personas Tab**

| ID | Requirement |
|----|-------------|
| MB-07 | The Personas tab shall list all personas with name, source badge, and active indicator. |
| MB-08 | Tapping a persona shall show a read-only trait summary. |

**Summary Tab**

| ID | Requirement |
|----|-------------|
| MB-09 | The Summary tab shall allow the operator to select a recent call and trigger the Email Agent to send a call summary to a specified recipient. |
| MB-10 | The tab shall display the generated summary text and the send status. |

---

## 6. Data Model Summary

| Table | Purpose | Key Relationships |
|-------|---------|-------------------|
| `calls` | One row per call, full intelligence payload | FK → `bots.id`, FK → `personas.id` |
| `bots` | Voice-bot instance configuration | Referenced by `calls.botId` |
| `personas` | Named persona versions | Has-many `persona_traits` |
| `persona_traits` | Versioned trait JSON per persona | FK → `personas.id` (cascade delete) |
| `persona_config` | Singleton default persona voice/style settings | — |
| `conversation_config` | Singleton conversation timing parameters | — |
| `llm_config` | Singleton LLM provider and circuit-breaker config | — |
| `flow_configs` | Named conversation flow definitions | — |
| `memory_entries` | Q&A knowledge base entries | — |
| `message_logs` | Outbound message delivery records | FK → `calls.id` (optional) |
| `calendar_invites` | Scheduled appointments | FK → `calls.id` (optional) |
| `email_agent_config` | Microsoft Graph mailbox credentials | — |
| `writing_style_profiles` | Learned email writing style | — |

---

## 7. API Surface

All endpoints are prefixed `/api` in the development proxy and served at `/v1/...` by the API server.

| Module | Method | Path | Description |
|--------|--------|------|-------------|
| Health | GET | `/v1/health` | Service health check |
| Calls | GET | `/v1/calls` | List calls (paginated) |
| | POST | `/v1/calls/dial` | Initiate outbound call |
| | POST | `/v1/calls/receive` | Inbound telephony webhook |
| | POST | `/v1/calls/inbound` | Create inbound call record |
| | GET | `/v1/calls/:id` | Call detail |
| | DELETE | `/v1/calls/:id` | Delete call |
| | POST | `/v1/calls/:id/transfer` | Transfer call |
| | POST | `/v1/calls/:id/conference` | Conference call |
| Personas | GET | `/v1/personas` | List personas |
| | POST | `/v1/personas` | Create persona |
| | GET | `/v1/personas/:id` | Persona detail |
| | PUT | `/v1/personas/:id/traits` | Update traits |
| | POST | `/v1/personas/:id/activate` | Activate persona |
| | POST | `/v1/personas/:id/regenerate` | AI-regenerate traits |
| | POST | `/v1/personas/:id/refine` | AI-refine traits |
| | POST | `/v1/personas/:id/test` | Test persona chat |
| | POST | `/v1/personas/:id/duplicate` | Duplicate persona |
| | DELETE | `/v1/personas/:id` | Delete persona |
| | GET | `/v1/personas/active/compose` | Get composed active prompt |
| Stats | GET | `/v1/stats/overview` | KPI card data |
| | GET | `/v1/stats/calls-by-hour` | 24-hour call volume |
| | GET | `/v1/stats/hangup-reasons` | Hangup reason distribution |
| | GET | `/v1/stats/connect-outcomes` | AMD outcome distribution |
| | GET | `/v1/stats/language-mix` | Language distribution |
| | GET | `/v1/stats/call-intelligence` | Interruption/escalation/barge-in stats |
| Bots | GET | `/v1/bots` | List bots |
| | POST | `/v1/bots` | Create bot |
| | GET | `/v1/bots/:id` | Bot detail |
| | PATCH | `/v1/bots/:id` | Update bot |
| | DELETE | `/v1/bots/:id` | Delete bot |
| Config | GET/PUT | `/v1/config/persona` | Persona defaults |
| | GET/PUT | `/v1/config/conversation` | Conversation timing |
| | GET/PUT | `/v1/config/llm` | LLM engine settings |
| | GET | `/v1/config/api-keys` | API key status |
| | POST | `/v1/config/api-keys/:service/test` | Test API key connectivity |
| Memory | GET | `/v1/memory/entries` | List memory entries |
| | POST | `/v1/memory/entries` | Create entry |
| | PUT | `/v1/memory/entries/:id` | Update entry |
| | DELETE | `/v1/memory/entries/:id` | Delete entry |
| | GET | `/v1/memory/stats` | Memory statistics |
| | POST | `/v1/memory/train` | Trigger training |
| Flow | GET | `/v1/flow/configs` | List flow configs |
| | POST | `/v1/flow/configs` | Create flow config |
| | GET | `/v1/flow/configs/:id` | Get flow config |
| | PUT | `/v1/flow/configs/:id` | Update flow config |
| | DELETE | `/v1/flow/configs/:id` | Delete flow config |
| Email Agent | GET/PUT | `/v1/email-agent/config` | Email agent config |
| | POST | `/v1/email-agent/test-connection` | Test mailbox connection |
| | GET | `/v1/email-agent/inbox` | Inbox messages |
| | GET | `/v1/email-agent/message/:id` | Message detail |
| | GET | `/v1/email-agent/thread/:id` | Thread view |
| | POST | `/v1/email-agent/reply` | Reply to thread |
| | POST | `/v1/email-agent/send-summary` | Send call summary email |
| | GET/PUT | `/v1/email-agent/style` | Writing style profile |
| | POST | `/v1/email-agent/learn-style` | Learn from examples |
| Messaging | POST | `/v1/messaging/whatsapp` | Send WhatsApp |
| | POST | `/v1/messaging/telegram` | Send Telegram |
| | POST | `/v1/messaging/email` | Send email |
| | GET | `/v1/messaging/logs` | Message delivery log |
| Calendar | POST | `/v1/calendar/invite` | Create calendar invite |
| | GET | `/v1/calendar/slots` | Get available slots |

---

## 8. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Performance** | API endpoints shall respond in < 500 ms under normal load for all non-LLM routes. LLM routes shall complete within 30 seconds or return a timeout error. |
| **Availability** | The API server shall expose a `/v1/health` endpoint for health monitoring. |
| **Data Integrity** | Persona traits are versioned; deleting a persona cascades to persona_traits but call records retain the `composedPrompt` snapshot. |
| **Security** | API keys stored in the DB shall be masked in all GET responses (only status, not the key value). The SESSION_SECRET environment variable shall be used for session signing and never logged. |
| **Logging** | All requests shall be logged via structured Pino logging (method, path, status, response time). |
| **Resilience** | The LLM engine shall implement a configurable circuit breaker: after N consecutive failures, requests are short-circuited until the recovery timeout elapses. |
| **Extensibility** | LLM provider is configurable; swapping the primary model requires only a config change, not a code deployment. |
| **Mobile** | The mobile app shall function on iOS 16+ and Android 12+ via Expo managed workflow. |

---

## 9. Constraints & Assumptions

| # | Statement |
|---|-----------|
| C1 | The system is single-tenant in v1.0. Multi-tenancy is out of scope. |
| C2 | Real-time TTS playback of persona voice in the browser is out of scope for v1.0. |
| C3 | Per-bot persona assignment is out of scope; persona is system-wide. |
| C4 | Multi-language persona profiles (separate trait sets per language) are out of scope for v1.0. |
| C5 | The telephony transport layer (SIP, carrier integration) is assumed to be provided by the operator's existing infrastructure; VoxAgent manages the logical call state via webhooks and API calls. |
| C6 | Calendar integration assumes Google Calendar (Meet link generation); Microsoft 365 calendar is a future integration. |
| C7 | Email integration requires a Microsoft Azure application registration with delegated Graph API permissions. |
| C8 | All timestamps are stored and returned in UTC. |

---

## 10. Glossary

| Term | Definition |
|------|-----------|
| **AMD** | Answering Machine Detection — classifying whether a picked-up call was answered by a human, voicemail, IVR, or not answered. |
| **Barge-in** | The act of a customer speaking while the bot is talking, interrupting the bot's current utterance. |
| **Composed Prompt** | The full system-prompt string generated by PersonaComposer from a persona's trait data, snapshotted at call start. |
| **Connect Outcome** | The result of AMD: one of HUMAN, VOICEMAIL, IVR, NO_ANSWER. |
| **Disposition** | The CRM-level outcome of a call (e.g. TRANSFERRED, BOT_HUNGUP, CUSTOMER_HANGUP). |
| **Escalation** | A moment in a call where the bot determines the conversation should be routed to a human agent. |
| **Fallback Chain** | An ordered list of LLM models to try if the primary model fails or times out. |
| **Memory Hit** | A call during which at least one memory entry was retrieved and used to answer a customer question. |
| **Persona** | A named, versioned AI persona with structured traits that determine the voice bot's identity, language, tone, voice, and behaviour. |
| **PersonaComposer** | The backend service module that translates persona traits into a natural-language system prompt. |
| **SIP** | Session Initiation Protocol — the telephony signalling protocol used for VoIP call setup. |
| **Trait** | A single configurable attribute of a persona (e.g. formality score, jargon tags, escalation trigger). |
| **Voice Bot** | The AI agent that conducts telephone conversations on behalf of the operator using a configured persona and system prompt. |

---

*End of Document*
