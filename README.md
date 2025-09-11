# fairsquare-libform

A small, reusable JavaScript library for powering **FairSquare** landing-page forms—validation, formatting, submission, and analytics hooks.

> Repo: `jhilton-fairsquare/fairsquare-libform`

---

## Table of contents

* [Features](#features)
* [Quick start](#quick-start)

  * [1) Via script tag (UMD)](#1-via-script-tag-umd)
  * [2) Via ES module (bundlers)](#2-via-es-module-bundlers)
* [Usage](#usage)

  * [HTML markup](#html-markup)
  * [Initialize](#initialize)
  * [Validation rules](#validation-rules)
  * [Events](#events)
  * [Analytics hooks](#analytics-hooks)
* [Styling](#styling)
* [Configuration reference](#configuration-reference)
* [Examples](#examples)
* [Local development](#local-development)
* [Releasing / versioning](#releasing--versioning)
* [Contributing](#contributing)
* [License](#license)

---

## Features

* Lightweight, framework-agnostic (vanilla JS) form helper
* Declarative validation via `data-` attributes
* Input masks/formatters for common fields (phone, currency, zip, etc.)
* Graceful async submission with JSON and `FormData` support
* Error summaries and field-level messages
* Prevent-double-submit + loading state helpers
* Pluggable analytics callbacks ("submitted", "validated", "error")

> *Note:* The repository includes a `example.html` demo page for quick manual testing.

---

## Usage

### HTML markup

```html
<form id="lead-form" data-libform method="post">
  <div class="field">
    <label for="name">Name</label>
    <input id="name" name="name" required />
    <small data-error-for="name"></small>
  </div>

  <div class="field">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" required />
    <small data-error-for="email"></small>
  </div>

  <div class="field">
    <label for="phone">Phone</label>
    <input id="phone" name="phone" data-format="phone" />
    <small data-error-for="phone"></small>
  </div>

  <button type="submit">Get a quote</button>
  <div class="form-status" aria-live="polite"></div>
</form>
```

* Add `data-libform` to any `<form>` you want the library to manage.
* Optional `data-error-for="<fieldName>"` elements will be populated automatically.
* Use `data-format` to opt into input masks (e.g., `phone`, `zip`, `currency`).

### Initialize

```js
import { createLibForm } from './lib/index.js';

const form = createLibForm('#lead-form', {
  endpoint: '/api/lead',           // POST target
  method: 'POST',                  // or 'GET'
  serialize: 'json',               // 'json' | 'form'
  autoValidate: true,              // validate on input/blur
  scrollToError: true,             // focus first invalid field
  blockers: ['[data-blocker]'],    // disable these during submit
});

form.on('submitted', ({ data, response }) => { /* ... */});
form.on('error', (err) => { /* ... */});
```

### Validation rules

Validation is driven by native constraints plus data attributes:

* Native: `required`, `type=email|url`, `minlength`, `maxlength`, `pattern`, etc.
* Extra attributes:

  * `data-validate="phone|zip|currency|name"`
  * `data-format="phone|zip|currency"` (format as user types)
  * `data-msg-required`, `data-msg-pattern`, etc. for custom messages

### Events

```js
form.on('validated', (ctx) => {/* every validate cycle */});
form.on('submit:start', (ctx) => {/* before network call */});
form.on('submitted', (ctx) => {/* after successful response */});
form.on('error', (ctx) => {/* network or validation error */});
```

### Analytics hooks

Provide a single analytics handler to mirror key lifecycle events.

```js
import { mount } from './lib/index.js';

mount('[data-libform]', {
  endpoint: '/api/lead',
  analytics: (event, payload) => {
    // event: 'validated' | 'submitted' | 'error'
    // payload: { form, data, response?, error? }
    window.dataLayer?.push({ event: `libform_${event}`, ...payload });
  },
});
```

---

## Styling

This package ships unopinionated. If you include `/lib/libform.css`, the following class hooks are used:

* `.is-invalid`, `.is-valid` on fields
* `.is-submitting` on the form during requests
* `[data-error-for]` containers receive messages

You can also inject your own renderer via options (see `messages.render`).

---

## Configuration reference

```ts
export type LibFormOptions = {
  endpoint: string;           // required
  method?: 'POST' | 'GET';
  headers?: Record<string,string>;
  serialize?: 'json' | 'form';
  autoValidate?: boolean;
  scrollToError?: boolean;
  blockers?: string[];        // selectors disabled during submit
  messages?: {
    render?: (field, message) => void; // custom error renderer
    summary?: string;          // form-level summary message
  };
  analytics?: (event: string, ctx: any) => void;
};
```

---

## Examples

* See `test.html` in the repo for a complete working example.
* Minimal no-build setup: open `test.html` via a local server and edit.

---

## Local development

```bash
# Install deps
npm install

# Run a local server / live-reload (choose what your setup uses)
npm run dev

# Lint / type-check
npm run lint

# Build distributables to /lib (or /dist depending on config)
npm run build
```

Open `test.html` in a local server (e.g., `npx http-server .`) to exercise the library manually.

---

## Releasing / versioning

* Follow Conventional Commits (e.g., `feat:`, `fix:`) and semantic versioning.
* Create a tag like `vX.Y.Z` when publishing.
* If you plan to ship to npm: set the `name` field and run `npm publish`.

---

## Contributing

1. Fork and create a feature branch
2. Add tests (if present), update docs, and en
