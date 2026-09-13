const screen = document.getElementById('screen');
const dialog = document.getElementById('info-dialog');
const state = {
    step: 1,
    username: '',
    email: '',
    phone: '',
    dob: '',
    gender: '',
    checks: {},
    selectedDate: new Date(),
    events: {}
};
// Preview only: credentials and profile details are never sent or persisted.
const usernamePattern = /^[A-Za-z][A-Za-z0-9_]{2,23}$/;
const hasDisallowed = s => /\s|\p{Extended_Pictographic}|[\u200D\uFE0F\u20E3]/u.test(s);
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
    return `<div class="field gender-field"><label id="gender-label" for="gender-trigger">Gender</label><input type="hidden" id="gender" name="gender" value="${escapeHtml(state.gender)}">${renderCustomSelect('gender', 'gender-label', 'gender-error', genderOptions(), state.gender, 'Select an option')}<p class="hint">You’re always welcome to keep this private.</p><p class="error" id="gender-error" aria-live="polite"></p></div>`;
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
    // Show login page, hide calendar
    document.getElementById('app-main').style.display = 'flex';
    document.getElementById('app-header').style.display = 'none';
    document.getElementById('app-layout').style.display = 'none';
    
    const screenEl = document.querySelector('[data-login-screen]') || document.querySelector('.form-area #screen') || screen;
    screenEl.innerHTML = `<span class="section-tag">YOUR PEOPLE. YOUR PLANS.</span><h2>Welcome back.</h2><p class="subtitle">A little planning. A lot more together.</p><button class="google" type="button" id="google"><span class="google-g" aria-hidden="true">G</span>Continue with Google</button><div class="divider">or sign in with your details</div><form id="login" novalidate>${field('identity', 'Email, username, or phone number', 'text', 'you@example.com', '', '', 'autocomplete="username" maxlength="254" required')}${field('password', 'Password', 'password', 'Enter your password', '', '', 'autocomplete="current-password" maxlength="128" required')}<div class="forgot-row"><button class="text-button" id="forgot" type="button">Forgot password?</button></div><button class="primary" type="submit">Sign in</button></form><p class="switch">New around here? <a href="#signup">Create an account</a></p>`;
    
    setTimeout(() => {
        const googleBtn = document.getElementById('google');
        const forgotBtn = document.getElementById('forgot');
        const loginForm = document.getElementById('login');
        
        if (googleBtn) googleBtn.onclick = () => openInfo('Continue with Google', '<p>Google sign-in will be available once account services are connected.</p><p>New members will still choose an OnTime username and complete their profile.</p>');
        if (forgotBtn) forgotBtn.onclick = () => openInfo('Reset your password', '<p>Password recovery will be available once account services are connected. No reset email is sent from this preview.</p>');
        
        if (loginForm) {
            loginForm.onsubmit = e => {
                e.preventDefault();
                const identityEl = document.getElementById('identity');
                const passwordEl = document.getElementById('password');
                
                if (identityEl && passwordEl) {
                    const v = identityEl.value;
                    let valid = !!v && !hasDisallowed(v) && (usernamePattern.test(v) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || /^\+?[0-9]{7,15}$/.test(v));
                    err('identity', valid ? '' : 'Enter an email, username, or phone number without spaces or emojis.');
                    const pw = passwordEl.value;
                    err('password', pw ? '' : 'Enter your password.');
                    if (valid && pw) {
                        passwordEl.value = '';
                        state.username = v;
                        showCalendar();
                    } else {
                        const invalidEl = screenEl.querySelector('[aria-invalid="true"]');
                        if (invalidEl) invalidEl.focus();
                    }
                }
            };
        }
        
        bind();
    }, 0);
}
function signup() {
    // Show login page, hide calendar
    document.getElementById('app-main').style.display = 'flex';
    document.getElementById('app-header').style.display = 'none';
    document.getElementById('app-layout').style.display = 'none';
    
    const step = state.step;
    screen.innerHTML = `<div data-signup><button type="button" class="back" id="back">← ${step === 1 ? 'Back to sign in' : 'Back'}</button><div class="steps" aria-label="Step ${step} of 3">${[1, 2, 3].map(n => `<span class="${n <= step ? 'active' : ''}"></span>`).join('')}</div><span class="section-tag">STEP ${step} OF 3</span><h2>${['Make yourself at home.', 'A little about you.', 'Good to know.'][step - 1]}</h2><p class="subtitle">${['Your next good plan starts here.', 'Let’s put a person behind the plans.', 'A few things to know before we begin.'][step - 1]}</p><form id="signup" novalidate>${step === 1 ? `${field('username', 'Choose your username', 'text', 'e.g. jeimy_01', state.username, '3–24 characters. Start with a letter. Letters, numbers, and underscores only.', 'autocomplete="username" maxlength="24" required')}${field('email', 'Email address', 'email', 'you@example.com', state.email, '', 'autocomplete="email" maxlength="254" required')}${field('phone', 'Phone number (optional)', 'tel', '+1 (555) 123-4567', state.phone, 'Format: +1 (555) 123-4567 or similar', 'autocomplete="tel"')}${field('new-password', 'Create a password', 'password', 'At least 12 characters', '', '12–128 characters. No spaces or emojis.', 'autocomplete="new-password" minlength="12" maxlength="128" required')}` : step === 2 ? `<div class="profile-fields">${dobField()}${genderField()}</div>` : `<div class="agreements">${[['terms', 'Terms & conditions', 'I have read and agree to the <button type="button" class="text-button" id="terms-link">Terms & Conditions</button>.'], ['recommendations', 'Event recommendations · optional', 'I’d like OnTime to suggest events I might enjoy using interests and other information I choose to share. I can change this choice later.']].map( ([id,title,copy]) => `<label class="check-row"><input id="${id}" type="checkbox" ${state.checks[id] ? 'checked' : ''}><span class="check-copy"><strong>${title}</strong>${copy}</span></label>`).join('')}</div><p class="error" id="checks-error" aria-live="polite"></p>`}<button class="primary" type="submit">${step === 3 ? 'Create account' : 'Continue'}</button></form>${step === 3 ? '<p class="small-note">Recommendations are optional and won’t affect account creation.</p>' : ''}</div>`;
    document.getElementById('back').onclick = () => {
        remember();
        if (state.step === 1)
            location.hash = 'login';
        else {
            state.step--;
            signup();
            focusHeading();
        }
    }
    ;
    if (step === 2) {
        bindDob();
        bindGender();
    }
    document.getElementById('terms-link')?.addEventListener('click', e => {
        e.preventDefault();
        openInfo('Terms & conditions', '<p><strong>Preview terms for OnTime</strong></p><h3>Planning & reminders</h3><p>You are responsible for tracking your events, deadlines, and commitments. Notifications may be delayed or unavailable. OnTime does not guarantee reminders and is not responsible for missed obligations.</p><h3>AI assistance</h3><p>OnTime was created with AI assistance. AI-powered suggestions may be inaccurate; review them before relying on them.</p><h3>Location choices</h3><p>Some features need location access while you use them. Permission will be requested separately. You can decline and continue using features that do not need location. No background location tracking is intended, and this frontend does not access your location.</p><p>These are draft acknowledgments for the frontend preview; final service terms and privacy information will be added before account registration is enabled.</p>');
    }
    );
    
    // Form submit handler moved to setTimeout below

        e.preventDefault();
        remember();
        let valid = true;
        if (step === 1) {
            valid = err('username', usernamePattern.test(state.username) ? '' : 'Use 3–24 letters, numbers, or underscores; start with a letter.') && valid;
            valid = err('email', /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(state.email) ? '' : 'Enter a valid email without spaces or emojis.') && valid;
            const pw = document.getElementById('new-password').value;
            valid = err('new-password', pw.length >= 12 && pw.length <= 128 && !hasDisallowed(pw) ? '' : 'Use 12–128 characters without spaces or emojis.') && valid;
        }
        if (step === 2) {
            const date = new Date(state.dob + 'T12:00:00');
            const today = new Date();
            const todayIso = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
            valid = err('dob', state.dob && Number.isFinite(+date) && date.getFullYear() > 0 && state.dob <= todayIso ? '' : 'Choose a full date of birth that isn’t in the future.') && valid;
            valid = err('gender', state.gender ? '' : 'Choose an option, including “Prefer not to say”.') && valid;
        }
        if (step === 3) {
            valid = !!state.checks.terms;
            document.getElementById('checks-error').textContent = valid ? '' : 'Please agree to the Terms & Conditions to continue.';
        }
        if (valid) {
            if (step < 3) {
                state.step++;
                signup();
                focusHeading();
            } else
                complete();
        } else {
            screen.querySelector('[aria-invalid="true"]')?.focus();
            if (step === 3)
                screen.querySelector('input:not(:checked)')?.focus();
        }
    }
    ;
    
    setTimeout(() => {
        const signupForm = document.getElementById('signup');
        if (signupForm) {
            signupForm.onsubmit = e => {
                e.preventDefault();
                remember();
                let valid = true;
                if (step === 1) {
                    valid = err('username', usernamePattern.test(state.username) ? '' : 'Use 3–24 letters, numbers, or underscores; start with a letter.') && valid;
                    valid = err('email', /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(state.email) ? '' : 'Enter a valid email without spaces or emojis.') && valid;
                    const pw = document.getElementById('new-password').value;
                    valid = err('new-password', pw.length >= 12 && pw.length <= 128 && !hasDisallowed(pw) ? '' : 'Use 12–128 characters without spaces or emojis.') && valid;
                }
                if (step === 2) {
                    const date = new Date(state.dob + 'T12:00:00');
                    const today = new Date();
                    const todayIso = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
                    valid = err('dob', state.dob && Number.isFinite(+date) && date.getFullYear() > 0 && state.dob <= todayIso ? '' : 'Choose a full date of birth that isn't in the future.') && valid;
                    valid = err('gender', state.gender ? '' : 'Choose an option, including "Prefer not to say".') && valid;
                }
                if (step === 3) {
                    valid = !!state.checks.terms;
                    document.getElementById('checks-error').textContent = valid ? '' : 'Please agree to the Terms & Conditions to continue.';
                }
                if (valid) {
                    if (step < 3) {
                        state.step++;
                        signup();
                        focusHeading();
                    } else
                        complete();
                } else {
                    screen.querySelector('[aria-invalid="true"]')?.focus();
                    if (step === 3)
                        screen.querySelector('input:not(:checked)')?.focus();
                }
            };
        }
        bind();
    }, 0);
}
function remember() {
    for (const k of ['username', 'email', 'phone', 'dob', 'gender']) {
        const i = document.getElementById(k);
        if (i)
            state[k] = i.value;
    }
    for (const k of ['terms', 'recommendations']) {
        const i = document.getElementById(k);
        if (i)
            state.checks[k] = i.checked;
    }
}
function complete() {
    showCalendar();
}
function getMonthName(date) {
    return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][date.getMonth()];
}
function getDayName(date) {
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];
}
function getHourSlots() {
    const hours = [];
    for (let i = 0; i < 24; i++) {
        const time = String(i).padStart(2, '0') + ':00';
        hours.push(time);
    }
    return hours;
}
function renderMiniCalendar(selectedDate) {
    const today = new Date();
    const firstDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const lastDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());
    const dates = [];
    let current = new Date(startDate);
    while (current <= lastDay) {
        dates.push(new Date(current));
        current.setDate(current.getDate() + 1);
    }
    const weeks = [];
    for (let i = 0; i < dates.length; i += 7) {
        weeks.push(dates.slice(i, i + 7));
    }
    let html = `<div class="mini-calendar"><h3>${getMonthName(selectedDate)} ${selectedDate.getFullYear()}</h3><div class="weekdays"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div><div class="dates">`;
    weeks.forEach(week => {
        week.forEach(date => {
            const isToday = date.toDateString() === today.toDateString();
            const isSelected = date.toDateString() === selectedDate.toDateString();
            const isCurrentMonth = date.getMonth() === selectedDate.getMonth();
            const className = isCurrentMonth ? 'current' : 'other';
            const circle = isToday ? 'today' : isSelected ? 'selected' : '';
            html += `<button type="button" class="date ${className} ${circle}" data-date="${date.toISOString().split('T')[0]}">${date.getDate()}</button>`;
        });
    });
    html += `</div></div>`;
    return html;
}
function renderDayView(date) {
    const hours = getHourSlots();
    let html = `<div class="day-view"><div class="day-header"><h2>${getDayName(date)}, ${getMonthName(date)} ${date.getDate()}</h2><button type="button" class="add-event-btn" id="add-event">+ Add event</button></div><div class="calendar-grid">`;
    hours.forEach(hour => {
        const dateStr = date.toISOString().split('T')[0];
        const eventKey = `${dateStr}-${hour}`;
        const hasEvent = state.events[eventKey];
        html += `<div class="hour-slot" data-time="${hour}"><span class="hour-label">${hour}</span><div class="event-area ${hasEvent ? 'has-event' : ''}" id="event-${eventKey}">${hasEvent ? `<div class="event-item">${hasEvent.title}<br><small>${hasEvent.attendees ? hasEvent.attendees.join(', ') : 'No attendees'}</small></div>` : ''}</div></div>`;
    });
    html += `</div></div>`;
    return html;
}
function showCalendar() {
    const selectedDate = state.selectedDate;
    
    // Show app layout and hide login form
    document.getElementById('app-main').style.display = 'none';
    document.getElementById('app-header').style.display = 'flex';
    document.getElementById('app-layout').style.display = 'flex';
    
    // Render mini calendar in sidebar
    document.querySelector('.calendar-sidebar').innerHTML = renderMiniCalendar(selectedDate);
    
    // Render day view in main area
    document.getElementById('calendar-content').innerHTML = renderDayView(selectedDate);
    
    // Bind mini calendar date buttons
    document.querySelectorAll('.mini-calendar .date').forEach(btn => {
        btn.onclick = () => {
            const date = new Date(btn.dataset.date + 'T00:00:00');
            state.selectedDate = date;
            showCalendar();
        };
    });
    
    // Bind add event button
    document.getElementById('add-event').onclick = () => {
        openEventDialog(selectedDate);
    };
    
    // Bind profile button
    document.getElementById('profile-btn').onclick = () => {
        showProfileDialog();
    };
}
    };
}
function openEventDialog(date) {
    const eventTitle = prompt(`Add event for ${getDayName(date)}, ${getMonthName(date)} ${date.getDate()}:`, '');
    if (eventTitle) {
        const time = prompt('Event time (HH:00):', '09:00');
        if (time && /^\d{2}:00$/.test(time)) {
            const attendees = prompt('Attendees (comma-separated usernames):', '');
            const dateStr = date.toISOString().split('T')[0];
            const eventKey = `${dateStr}-${time}`;
            state.events[eventKey] = {
                title: eventTitle,
                time: time,
                attendees: attendees ? attendees.split(',').map(a => a.trim()) : []
            };
            showCalendar();
            openInfo('Event created', `<p><strong>${eventTitle}</strong></p><p>Time: ${time}</p><p>Attendees: ${attendees || 'None'}</p><p>Invites will be sent to the specified users.</p>`);
        } else {
            alert('Invalid time format. Please use HH:00');
        }
    }
}
function showProfileDialog() {
    const profileDialog = document.getElementById('profile-dialog');
    const profileContent = document.getElementById('profile-content');
    profileContent.innerHTML = `
        <div class="profile-info">
            <p><strong>Username:</strong> ${escapeHtml(state.username)}</p>
            <p><strong>Email:</strong> ${escapeHtml(state.email)}</p>
            ${state.phone ? `<p><strong>Phone:</strong> ${escapeHtml(state.phone)}</p>` : ''}
            <p><strong>Date of Birth:</strong> ${state.dob || 'Not provided'}</p>
            <p><strong>Gender:</strong> ${state.gender || 'Not provided'}</p>
        </div>
    `;
    document.getElementById('signout-btn').onclick = () => {
        profileDialog.close();
        state.step = 1;
        state.username = '';
        state.email = '';
        state.phone = '';
        state.dob = '';
        state.gender = '';
        state.checks = {};
        state.selectedDate = new Date();
        state.events = {};
        document.getElementById('app-header').style.display = 'none';
        document.getElementById('app-layout').style.display = 'none';
        document.getElementById('app-main').style.display = 'flex';
        location.hash = 'login';
    };
    profileDialog.showModal();
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
    route();
    focusHeading();
}
);
route();
