import { ipcRenderer } from 'electron';

/**
 * Login form support, running in every frame in an isolated world (page scripts can't see it).
 * It never learns which site it is on from the page: the main process decides from the frame URL.
 * Saved passwords only reach a frame when the browser fills them.
 */

const SUBMIT_TEXT = /accedi|entra|login|log in|sign in|signin|continua|continue|avanti|next|registr|sign up|crea account|create account|conferma|invia|submit/i;

type Field = HTMLInputElement;

function visible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function passwordFields(root: ParentNode = document): Field[] {
  return [...root.querySelectorAll<Field>('input[type=password]')].filter((f) => visible(f) && !f.disabled && !f.readOnly);
}

/** The form (or the whole document for form-less logins) a field belongs to. */
function scope(field: Field): ParentNode {
  return field.form ?? document;
}

/** Username field of a login: autocomplete hints first, else the last text-like input before the password. */
function usernameField(password: Field): Field | null {
  const root = scope(password);
  const inputs = [...root.querySelectorAll<Field>('input')].filter((i) => visible(i) && !i.disabled);
  const hinted = inputs.find((i) => /username|email/.test(i.autocomplete));
  if (hinted) return hinted;
  const candidates = inputs.filter((i) => ['text', 'email', 'tel', ''].includes(i.type) && i.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING);
  return candidates[candidates.length - 1] ?? null;
}

function isNewPasswordField(field: Field): boolean {
  if (field.autocomplete === 'new-password') return true;
  if (field.autocomplete === 'current-password') return false;
  return passwordFields(scope(field)).length >= 2;
}

/** Sets a value the way typing would, so frameworks (React, Vue…) notice the change. */
function setValue(field: Field, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter ? setter.call(field, value) : (field.value = value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

const filled = new WeakMap<Field, string>();

function fill(data: { username?: string; password: string; generated?: boolean }): void {
  const active = document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
  const target = active && (active.type === 'password' || usernameFieldOfAny() === active) ? active : null;
  const passwords = passwordFields(target ? scope(target) : document);
  if (passwords.length === 0) return;

  if (data.generated) {
    // Fill the new password and its confirmation, not the current password of a change form.
    const fields = passwords.filter(isNewPasswordField);
    for (const f of fields.length ? fields : passwords.slice(0, 1)) {
      setValue(f, data.password);
      filled.set(f, data.password);
    }
    return;
  }
  const password = passwords.find((f) => !isNewPasswordField(f)) ?? passwords[0];
  setValue(password, data.password);
  filled.set(password, data.password);
  const user = usernameField(password);
  if (user && data.username !== undefined) {
    setValue(user, data.username);
    filled.set(user, data.username);
  }
}

function usernameFieldOfAny(): Field | null {
  const first = passwordFields()[0];
  return first ? usernameField(first) : null;
}

/** Reads what the user is about to submit. */
function collect(root: ParentNode): { username: string; password: string } | null {
  const fields = passwordFields(root).filter((f) => f.value);
  if (fields.length === 0) return null;
  let password = fields[0].value;
  if (fields.length === 3) password = fields[1].value; // current, new, confirm
  else if (fields.length === 2 && fields[0].value !== fields[1].value) password = fields[1].value; // current, new
  const user = usernameField(fields[0]);
  return { username: user?.value.trim() ?? '', password };
}

let lastSent = '';
function submitted(root: ParentNode): void {
  const data = collect(root);
  if (!data) return;
  const key = `${data.username}\u0000${data.password}`;
  if (key === lastSent) return;
  lastSent = key;
  ipcRenderer.send('pw:submit', data);
}

function isLoginField(el: EventTarget | null): el is Field {
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.type === 'password') return true;
  const first = passwordFields(scope(el))[0];
  return Boolean(first && usernameField(first) === el);
}

function start(): void {
  // Capture: form submit, Enter in a password field, click on a submit-looking button.
  document.addEventListener('submit', (e) => submitted(e.target as HTMLFormElement), true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement && isLoginField(e.target)) submitted(scope(e.target));
  }, true);
  document.addEventListener('click', (e) => {
    const button = (e.target as Element | null)?.closest?.('button, input[type=submit], input[type=button], [role=button]');
    if (!button) return;
    const isSubmit = (button as HTMLButtonElement).type === 'submit' || SUBMIT_TEXT.test(button.textContent ?? '') || SUBMIT_TEXT.test((button as HTMLInputElement).value ?? '');
    if (isSubmit) submitted((button as HTMLButtonElement).form ?? document);
  }, true);

  // Choosing a saved login or a generated password: click in an empty (or browser-filled) login field.
  document.addEventListener('click', (e) => {
    const field = e.target;
    if (!isLoginField(field)) return;
    if (field.value && filled.get(field) !== field.value) return;
    void ipcRenderer.invoke('pw:field-click', { newPassword: field.type === 'password' && isNewPasswordField(field) });
  }, true);

  // Autofill once, when a login form shows up.
  let asked = false;
  const check = () => {
    if (asked || passwordFields().length === 0) return;
    asked = true;
    void ipcRenderer.invoke('pw:page').then((result: { username: string; password: string } | null) => {
      if (!result) return;
      const password = passwordFields().find((f) => !isNewPasswordField(f));
      const user = password ? usernameField(password) : null;
      // Never overwrite what the user already typed.
      if (!password || password.value || (user && user.value && user.value !== result.username)) return;
      fill(result);
    });
  };
  check();
  const observer = new MutationObserver(() => check());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 30_000);
}

if (/^https?:$/.test(location.protocol)) {
  ipcRenderer.on('pw:fill', (_e, data) => fill(data));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
