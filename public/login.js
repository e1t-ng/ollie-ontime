const screen = document.getElementById('screen');
const dialog = document.getElementById('info-dialog');
const state = {
    step: 1,
    username: '',
    email: '',
    phone: '',
    password: '',
    dob: '',
    gender: '',
    checks: {},
    googleSignIn: false
};
// The password stays in memory for the length of the signup flow and is sent once to
// POST /api/auth/register on the same origin. Nothing here writes to browser storage.
const usernamePattern = /^[A-Za-z][A-Za-z0-9_]{2,23}$/;
// Mirrors the server policy in server/api.ts; keep the two in step.
const MIN_PASSWORD = 15;
const hasDisallowed = s => /\s|\p{Extended_Pictographic}|[\u200D\uFE0F\u20E3]/u.test(s);
const hasEmoji = s => /\p{Extended_Pictographic}|[\u200D\uFE0F\u20E3]/u.test(s);
const query = new URLSearchParams(location.search);
// Only same-site paths are followed, so a crafted link cannot redirect sign-in elsewhere.
const next = (value => value && value.startsWith('/') && !value.startsWith('//') && value.length <= 200 ? value : '/')(query.get('next'));
const signInErrors = {
    google_unavailable: 'Google sign-in is not set up for this deployment yet.',
    google_denied: 'Google sign-in was cancelled.',
    google_expired: 'That Google sign-in took too long. Please try again.',
    google_email: 'Google has not verified that email address, so it cannot be used to sign in.',
    google_exists: 'An account already uses that email address. Sign in with your password instead.',
    google_failed: 'Google could not finish this sign-in. Please try again.'
};
let googleReady = true;
let bootError = query.get('error') ? (signInErrors[query.get('error')] || 'That sign-in could not be completed. Please try again.') : '';
async function api(path, method = 'GET', data) {
    let response;
    try {
        response = await fetch(path, {
            method,
            credentials: 'same-origin',
            ...(data === undefined ? {} : {
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            })
        });
    } catch {
        throw new Error('We could not reach OnTime. Check your connection and try again.');
    }
    let result = {};
    try {
        result = await response.json();
    } catch {}
    if (!response.ok)
        throw new Error(result.error || 'Something went wrong. Please try again.');
    return result;
}
function notify(message) {
    const target = document.getElementById('form-error');
    if (target)
        target.textContent = message || '';
}
function busy(form, on, label) {
    const button = form?.querySelector('button[type="submit"]');
    if (!button)
        return;
    if (on)
        button.dataset.idle = button.textContent;
    button.disabled = on;
    button.textContent = on ? label : (button.dataset.idle || button.textContent);
}
function leave() {
    location.replace(next);
}
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
}[c]));
function field(id, label, type='text', placeholder='', value='', hint='', attrs='') {
    return `<div class="field"><label for="${id}">${label}</label><div class="input-wrap"><input id="${id}" name="${id}" type="${type}" placeholder="${placeholder}" value="${escapeHtml(value)}" aria-describedby="${id}-hint ${id}-error" ${attrs}>${type === 'password' ? `<button class="reveal" type="button" data-reveal="${id}" aria-label="Show password">Show</button>` : ''}</div><p class="hint" id="${id}-hint">${hint}</p><p class="error" id="${id}-error" aria-live="polite"></p></div>`;
}
function err(id, message) {
    const ids = id === 'gender' ? ['gender-trigger'] : id === 'dob' ? ['dob-month-trigger', 'dob-day-trigger', 'dob-year-trigger'] : [id];
    ids.forEach(elId => document.getElementById(elId)?.setAttribute('aria-invalid', message ? 'true' : 'false'));
    const target = document.getElementById(id + '-error');
    if (target)
        target.textContent = message;
    return !message;
}
function openInfo(title, html) {
    document.getElementById('dialog-title').textContent = title;
    document.getElementById('dialog-content').innerHTML = html;
    dialog.showModal();
}
document.querySelector('.dialog-close').onclick = () => dialog.close();
document.getElementById('dialog-done').onclick = () => dialog.close();
dialog.addEventListener('click', e => {
    if (e.target === dialog && e.clientX < dialog.getBoundingClientRect().left)
        dialog.close();
}
);
function renderSelectOptions(options, selected) {
    return options.map(o => `<button type="button" role="option" data-value="${escapeHtml(o.value)}" aria-selected="${o.value === selected}" tabindex="-1">${escapeHtml(o.label)}<span aria-hidden="true">${o.value === selected ? '✓' : ''}</span></button>`).join('');
}
function renderCustomSelect(prefix, labelledby, describedby, options, selected, placeholder) {
    const current = options.find(o => o.value === selected);
    return `<div class="custom-select" id="${prefix}-wrap"><button class="select-trigger" id="${prefix}-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="${prefix}-options" aria-labelledby="${labelledby} ${prefix}-value" aria-describedby="${describedby}"><span id="${prefix}-value">${escapeHtml(current ? current.label : placeholder)}</span><span class="chevron" aria-hidden="true"></span></button><div class="select-options" id="${prefix}-options" role="listbox" aria-labelledby="${labelledby}" hidden>${renderSelectOptions(options, selected)}</div></div>`;
}
function bindCustomSelect(prefix, onSelect) {
    const trigger = document.getElementById(`${prefix}-trigger`)
      , list = document.getElementById(`${prefix}-options`)
      , wrap = document.getElementById(`${prefix}-wrap`);
    if (!trigger || !list)
        return;
    const options = [...list.querySelectorAll('[role="option"]')];
    const close = (focus=false) => {
        list.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        if (focus)
            trigger.focus();
    }
    ;
    const open = () => {
        list.classList.remove('above');
        list.hidden = false;
        if (list.getBoundingClientRect().bottom > document.querySelector('.auth-card').getBoundingClientRect().bottom - 12)
            list.classList.add('above');
        trigger.setAttribute('aria-expanded', 'true');
        (options.find(o => o.getAttribute('aria-selected') === 'true') || options[0])?.focus();
    }
    ;
    trigger.onclick = () => list.hidden ? open() : close();
    trigger.onkeydown = e => {
        if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
            e.preventDefault();
            open();
        }
    }
    ;
    options.forEach( (option, index) => {
        option.onclick = () => {
            options.forEach(o => {
                const chosen = o === option;
                o.setAttribute('aria-selected', String(chosen));
                o.lastElementChild.textContent = chosen ? '✓' : '';
            }
            );
            close(true);
            onSelect(option.dataset.value, option.firstChild.textContent);
        }
        ;
        option.onkeydown = e => {
            if (e.key === 'Escape') {
                e.preventDefault();
                close(true);
            }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                e.preventDefault();
                const next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
                options[next].focus();
            }
            if (e.key === 'Tab')
                close();
        }
        ;
    }
    );
    if (wrap)
        wrap.onfocusout = e => {
            if (!wrap.contains(e.relatedTarget))
                close();
        }
        ;
}
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function monthOptions() {
    return monthNames.map( (m, i) => ({
        value: String(i + 1).padStart(2, '0'),
        label: m
    }));
}
function daysInMonth(month, year) {
    if (!month)
        return 31;
    const y = year ? Number(year) : 2000;
    return new Date(y,Number(month),0).getDate();
}
function dayOptions(month, year) {
    const count = daysInMonth(month, year);
    return Array.from({
        length: count
    }, (_, i) => ({
        value: String(i + 1).padStart(2, '0'),
        label: String(i + 1)
    }));
}
function yearOptions() {
    const current = new Date().getFullYear();
    const years = [];
    for (let y = current; y >= current - 120; y--)
        years.push({
            value: String(y),
            label: String(y)
        });
    return years;
}
function genderOptions() {
    return ['Woman', 'Man', 'Non-binary', 'Prefer not to say'].map(g => ({
        value: g,
        label: g
    }));
}
function dobField() {
    const [y = '', m = '', d = ''] = (state.dob || '').split('-');
    return `<div class="field dob-field"><label id="dob-label" for="dob-month-trigger">Date of birth</label><input type="hidden" id="dob" name="dob" value="${escapeHtml(state.dob)}"><div class="dob-grid">${renderCustomSelect('dob-month', 'dob-label', 'dob-error', monthOptions(), m, 'Month')}${renderCustomSelect('dob-day', 'dob-label', 'dob-error', dayOptions(m, y), d, 'Day')}${renderCustomSelect('dob-year', 'dob-label', 'dob-error', yearOptions(), y, 'Year')}</div><p class="hint">Choose your birthday.</p><p class="error" id="dob-error" aria-live="polite"></p></div>`;
}
function genderField() {
    return `<div class="field gender-field"><label id="gender-label" for="gender-trigger">Gender</label><input type="hidden" id="gender" name="gender" value="${escapeHtml(state.gender)}">${renderCustomSelect('gender', 'gender-label', 'gender-error', genderOptions(), state.gender, 'Select an option')}<p class="hint">You're always welcome to keep this private.</p><p class="error" id="gender-error" aria-live="polite"></p></div>`;
}
function bindDob() {
    const parts = () => {
        const [y = '', m = '', d = ''] = (state.dob || '').split('-');
        return {
            y,
            m,
            d
        };
    }
    ;
    const setParts = ({y, m, d}) => {
        state.dob = (y || m || d) ? `${y}-${m}-${d}` : '';
        const hidden = document.getElementById('dob');
        if (hidden)
            hidden.value = state.dob;
        err('dob', '');
    }
    ;
    const refreshDay = () => {
        const {y, m, d} = parts();
        const options = dayOptions(m, y);
        const valid = d && options.some(o => o.value === d) ? d : '';
        if (valid !== d)
            setParts({
                y,
                m,
                d: valid
            });
        const list = document.getElementById('dob-day-options');
        list.innerHTML = renderSelectOptions(options, valid);
        const current = options.find(o => o.value === valid);
        document.getElementById('dob-day-value').textContent = current ? current.label : 'Day';
        bindCustomSelect('dob-day', (value, label) => {
            setParts({
                ...parts(),
                d: value
            });
            document.getElementById('dob-day-value').textContent = label;
        }
        );
    }
    ;
    bindCustomSelect('dob-month', (value, label) => {
        setParts({
            ...parts(),
            m: value
        });
        document.getElementById('dob-month-value').textContent = label;
        refreshDay();
    }
    );
    bindCustomSelect('dob-year', (value, label) => {
        setParts({
            ...parts(),
            y: value
        });
        document.getElementById('dob-year-value').textContent = label;
        refreshDay();
    }
    );
    refreshDay();
}
function bindGender() {
    bindCustomSelect('gender', (value, label) => {
        state.gender = value;
        const hidden = document.getElementById('gender');
        if (hidden)
            hidden.value = value;
        document.getElementById('gender-value').textContent = label;
        err('gender', '');
    }
    );
}
function focusHeading() {
    const h = screen.querySelector('h2');
    h?.setAttribute('tabindex', '-1');
    h?.focus({
        preventScroll: true
    });
}
function bind() {
    screen.querySelectorAll('[data-reveal]').forEach(b => b.onclick = () => {
        const i = document.getElementById(b.dataset.reveal);
        i.type = i.type === 'password' ? 'text' : 'password';
        b.textContent = i.type === 'password' ? 'Show' : 'Hide';
        b.setAttribute('aria-label', `${b.textContent} password`);
    }
    );
    screen.querySelectorAll('input,select').forEach(i => i.addEventListener('input', () => {
        err(i.id, '');
        if (i.id === 'terms' && i.checked) {
            const notice = document.getElementById('checks-error');
            if (notice)
                notice.textContent = '';
        }
    }
    ));
}
function login() {
    screen.innerHTML = `<span class="section-tag">YOUR PEOPLE. YOUR PLANS.</span><h2>Welcome back.</h2><p class="subtitle">A little planning. A lot more together.</p>${googleReady ? `<button class="google" type="button" id="google"><span class="google-g" aria-hidden="true">G</span>Continue with Google</button><div class="divider">or sign in with your details</div>` : ''}<form id="login" novalidate>${field('identity', 'Email or username', 'text', 'you@example.com', '', '', 'autocomplete="username" maxlength="254" required')}${field('password', 'Password', 'password', 'Enter your password', '', '', 'autocomplete="current-password" maxlength="128" required')}<div class="forgot-row"><button class="text-button" id="forgot" type="button">Forgot password?</button></div><p class="error form-error" id="form-error" aria-live="polite"></p><button class="primary" type="submit">Sign in</button></form><p class="switch">New around here? <a href="#signup">Create an account</a></p>`;
    const googleButton = document.getElementById('google');
    if (googleButton)
        googleButton.onclick = () => {
            googleButton.disabled = true;
            // A full navigation: the handshake and the session cookie are set server-side.
            location.href = '/api/auth/google/start?next=' + encodeURIComponent(next);
        }
    ;
    document.getElementById('forgot').onclick = () => {
        openInfo('Reset your password', '<p>Password reset emails are not switched on yet, so OnTime cannot send you a link. Ask the OnTime team to reset your password for you.</p><p style="font-size: 14px; color: #657875; margin-top: 20px;">If you created your account with Google, use <strong>Continue with Google</strong> instead \u2014 those accounts have no password.</p>');
    }
    ;
    document.getElementById('login').onsubmit = async e => {
        e.preventDefault();
        const form = e.target;
        const identity = document.getElementById('identity').value.trim();
        const valid = err('identity', !!identity && !hasDisallowed(identity) && (usernamePattern.test(identity) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity)) ? '' : 'Enter the email address or username on your account.');
        const pw = document.getElementById('password').value;
        notify('');
        if (!(err('password', pw ? '' : 'Enter your password.') && valid)) {
            screen.querySelector('[aria-invalid="true"]')?.focus();
            return;
        }
        busy(form, true, 'Signing in\u2026');
        try {
            await api('/api/auth/login', 'POST', {
                identifier: identity,
                password: pw
            });
            document.getElementById('password').value = '';
            leave();
        } catch (error) {
            busy(form, false);
            notify(error.message);
            document.getElementById('password').focus();
        }
    }
    ;
    bind();
    notify(bootError);
}
function signup() {
    const step = state.step;
    const isGoogle = state.googleSignIn;
    const totalSteps = isGoogle ? 2 : 3;
    const displayStep = isGoogle ? (step === 2 ? 1 : step === 3 ? 2 : step) : step;
    
    let stepTitle, stepSubtitle, stepContent;
    
    if (isGoogle) {
        if (step === 2) {
            stepTitle = 'A little about you.';
            stepSubtitle = 'Let\'s put a person behind the plans.';
            stepContent = `<div class="profile-fields">${dobField()}${genderField()}</div>`;
        } else {
            stepTitle = 'Good to know.';
            stepSubtitle = 'A few things to know before we begin.';
            stepContent = `<div class="agreements">${[['terms', 'Terms & conditions', 'I have read and agree to the <button type="button" class="text-button" id="terms-link">Terms & Conditions</button>.'], ['recommendations', 'Event recommendations · optional', 'I\'d like OnTime to suggest events I might enjoy using interests and other information I choose to share. I can change this choice later.']].map( ([id,title,copy]) => `<label class="check-row"><input id="${id}" type="checkbox" ${state.checks[id] ? 'checked' : ''}><span class="check-copy"><strong>${title}</strong>${copy}</span></label>`).join('')}</div><p class="error" id="checks-error" aria-live="polite"></p>`;
        }
    } else {
        if (step === 1) {
            stepTitle = 'Make yourself at home.';
            stepSubtitle = 'Your next good plan starts here.';
            stepContent = `${field('username', 'Choose your username', 'text', 'e.g. jeimy_01', state.username, '3–24 characters. Start with a letter. Letters, numbers, and underscores only.', 'autocomplete="username" maxlength="24" required')}${field('email', 'Email address', 'email', 'you@example.com', state.email, '', 'autocomplete="email" maxlength="254" required')}${field('phone', 'Phone number · optional', 'tel', '+1 (555) 000-0000', state.phone, 'Enter a phone number or leave blank.', 'autocomplete="tel" maxlength="20"')}${field('new-password', 'Create a password', 'password', 'At least 15 characters', state.password, '15–128 characters. Emojis aren\'t supported.', 'autocomplete="new-password" minlength="15" maxlength="128" required')}`;
        } else if (step === 2) {
            stepTitle = 'A little about you.';
            stepSubtitle = 'Let\'s put a person behind the plans.';
            stepContent = `<div class="profile-fields">${dobField()}${genderField()}</div>`;
        } else {
            stepTitle = 'Good to know.';
            stepSubtitle = 'A few things to know before we begin.';
            stepContent = `<div class="agreements">${[['terms', 'Terms & conditions', 'I have read and agree to the <button type="button" class="text-button" id="terms-link">Terms & Conditions</button>.'], ['recommendations', 'Event recommendations · optional', 'I\'d like OnTime to suggest events I might enjoy using interests and other information I choose to share. I can change this choice later.']].map( ([id,title,copy]) => `<label class="check-row"><input id="${id}" type="checkbox" ${state.checks[id] ? 'checked' : ''}><span class="check-copy"><strong>${title}</strong>${copy}</span></label>`).join('')}</div><p class="error" id="checks-error" aria-live="polite"></p>`;
        }
    }
    
    const backText = isGoogle ? (step === 2 ? 'Skip for now' : 'Back') : (step === 1 ? 'Back to sign in' : 'Back');
    const stepIndicators = Array.from({length: totalSteps}, (_, n) => n + 1).map(n => `<span class="${n <= displayStep ? 'active' : ''}"></span>`).join('');
    // A Google account already exists by this point, so it is finished, not created.
    const buttonText = step === 3 ? (isGoogle ? 'Finish setting up' : 'Create account') : 'Continue';
    const smallNote = step === 3 ? '<p class="small-note">Recommendations are optional and won\'t affect your account.</p>' : '';
    
    screen.innerHTML = `<div data-signup><button type="button" class="back" id="back">← ${backText}</button><div class="steps" aria-label="Step ${displayStep} of ${totalSteps}">${stepIndicators}</div><span class="section-tag">STEP ${displayStep} OF ${totalSteps}</span><h2>${stepTitle}</h2><p class="subtitle">${stepSubtitle}</p><form id="signup" novalidate>${stepContent}<p class="error form-error" id="form-error" aria-live="polite"></p><button class="primary" type="submit">${buttonText}</button></form>${smallNote}</div>`;
    
    document.getElementById('back').onclick = () => {
        remember();
        if (state.googleSignIn) {
            if (state.step === 2) {
                // The Google handshake already created the account and the session.
                leave();
            } else {
                state.step--;
                signup();
                focusHeading();
            }
        } else {
            if (state.step === 1)
                location.hash = 'login';
            else {
                state.step--;
                signup();
                focusHeading();
            }
        }
    }
    ;
    if ((isGoogle && step === 2) || (!isGoogle && step === 2)) {
        bindDob();
        bindGender();
    }
    document.getElementById('terms-link')?.addEventListener('click', e => {
        e.preventDefault();
        openInfo('Terms & conditions', '<p><strong>Preview terms for OnTime</strong></p><h3>Planning & reminders</h3><p>You are responsible for tracking your events, deadlines, and commitments. Notifications may be delayed or unavailable. OnTime does not guarantee reminders and is not responsible for missed obligations.</p><h3>AI assistance</h3><p>OnTime was created with AI assistance. AI-powered suggestions may be inaccurate; review them before relying on them.</p><h3>Location choices</h3><p>Some features need location access while you use them. Permission will be requested separately. You can decline and continue using features that do not need location. No background location tracking is intended, and this frontend does not access your location.</p><p>These are draft acknowledgments for the frontend preview; final service terms and privacy information will be added before account registration is enabled.</p>');
    }
    );
    document.getElementById('signup').onsubmit = async e => {
        e.preventDefault();
        remember();
        notify('');
        let valid = true;
        
        if (!isGoogle && step === 1) {
            valid = err('username', usernamePattern.test(state.username) ? '' : 'Use 3–24 letters, numbers, or underscores; start with a letter.') && valid;
            valid = err('email', /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(state.email) ? '' : 'Enter a valid email without spaces or emojis.') && valid;
            const pw = document.getElementById('new-password').value;
            state.password = pw;
            valid = err('new-password', pw.length >= MIN_PASSWORD && pw.length <= 128 && !hasEmoji(pw) ? '' : `Use ${MIN_PASSWORD}–128 characters without emojis.`) && valid;
        }
        
        if ((isGoogle && step === 2) || (!isGoogle && step === 2)) {
            const date = new Date(state.dob + 'T12:00:00');
            const today = new Date();
            const todayIso = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
            valid = err('dob', state.dob && Number.isFinite(+date) && date.getFullYear() > 0 && state.dob <= todayIso ? '' : 'Choose a full date of birth that isn\'t in the future.') && valid;
            valid = err('gender', state.gender ? '' : 'Choose an option, including "Prefer not to say".') && valid;
        }
        
        if ((isGoogle && step === 3) || (!isGoogle && step === 3)) {
            valid = !!state.checks.terms;
            document.getElementById('checks-error').textContent = valid ? '' : 'Please agree to the Terms & Conditions to continue.';
        }
        
        if (!valid) {
            screen.querySelector('[aria-invalid="true"]')?.focus();
            if (step === 3)
                screen.querySelector('input:not(:checked)')?.focus();
            return;
        }
        if (step < 3) {
            state.step++;
            signup();
            focusHeading();
            return;
        }
        const form = e.target;
        busy(form, true, isGoogle ? 'Finishing…' : 'Creating your account…');
        try {
            await complete();
        } catch (error) {
            busy(form, false);
            notify(/already exists/i.test(error.message) ? 'That email address or username is already taken. Go back to step 1 to choose another.' : error.message);
        }
    }
    ;
    bind();
}
function remember() {
    for (const k of ['username', 'email', 'phone', 'dob', 'gender']) {
        const i = document.getElementById(k);
        if (i)
            state[k] = i.value;
    }
    const password = document.getElementById('new-password');
    if (password)
        state.password = password.value;
    for (const k of ['terms', 'recommendations']) {
        const i = document.getElementById(k);
        if (i)
            state.checks[k] = i.checked;
    }
}
async function complete() {
    const profile = {
        birthday: state.dob || '',
        gender: state.gender || '',
        eventRecommendations: !!state.checks.recommendations,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    };
    if (state.googleSignIn)
        // The Google callback already created this account; finish its profile.
        await api('/api/profile', 'PATCH', profile);
    else
        await api('/api/auth/register', 'POST', {
            email: state.email.trim().toLowerCase(),
            username: state.username.trim().toLowerCase(),
            password: state.password,
            name: state.username.trim(),
            phone: state.phone.trim(),
            ...profile
        });
    state.password = '';
    screen.innerHTML = `<div class="success-icon" aria-hidden="true">\u2713</div><span class="section-tag">YOUR ACCOUNT IS READY</span><h2>Welcome to OnTime, <span id="chosen-name"></span>.</h2><p class="subtitle">You're signed in. Let's make room for the good stuff.</p><div class="summary">Taking you to your calendar\u2026</div><button class="primary" id="finish">Go to my calendar</button>`;
    document.getElementById('chosen-name').textContent = state.username || 'friend';
    document.getElementById('finish').onclick = leave;
    focusHeading();
    setTimeout(leave, 1500);
}
function route() {
    if (location.hash === '#signup')
        signup();
    else
        login();
}
document.addEventListener('pointerdown', e => {
    document.querySelectorAll('.custom-select').forEach(wrap => {
        if (wrap.contains(e.target))
            return;
        const list = wrap.querySelector('[role="listbox"]')
          , trigger = wrap.querySelector('.select-trigger');
        if (list && !list.hidden) {
            list.hidden = true;
            trigger?.setAttribute('aria-expanded', 'false');
        }
    }
    );
}
);
addEventListener('hashchange', () => {
    bootError = '';
    route();
    focusHeading();
}
);
async function boot() {
    // Keep the handshake parameters out of the address bar so a refresh cannot replay them.
    if (location.search)
        history.replaceState({}, '', location.pathname + location.hash);
    let ready = false;
    try {
        ready = (await api('/api/auth/providers')).google === true;
    } catch {}
    let user = null;
    try {
        user = (await api('/api/auth/me')).user;
    } catch {}
    if (user && query.get('google') === 'new') {
        state.googleSignIn = true;
        state.username = user.username;
        state.email = user.email;
        state.step = 2;
        signup();
        focusHeading();
        return;
    }
    if (user && !bootError) {
        leave();
        return;
    }
    if (ready !== googleReady) {
        googleReady = ready;
        route();
    }
}
route();
boot();
