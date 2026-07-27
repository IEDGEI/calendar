const SUPABASE_URL = 'https://bukgcsoifruzxyycbvzi.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qUPnfXni_qOdCzBA7kaeRA_n7NWLv4b';
const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);

const AppState = {
    currentView: 'landing',
    authUserId: '',
    room: null,
    user: {
        nickname: localStorage.getItem('inverse_calendar_nick') || '',
        roomCode: ''
    },
    calendar: {
        year: new Date().getFullYear(),
        month: new Date().getMonth()
    },
    loadedSchedules: [],
    loadedParticipants: [],
    realtimeChannel: null,
    realtimePauseTimer: null,
    realtimeSequence: 0,
    realtimeRefreshTimer: null,
    pendingDates: new Set()
};

const Database = {
    async ensureAnonymousSession() {
        const { data: sessionData, error: sessionError } =
            await supabaseClient.auth.getSession();
        if (sessionError) throw sessionError;
        if (sessionData.session?.user) return sessionData.session.user;

        const { data, error } = await supabaseClient.auth.signInAnonymously();
        if (error) throw error;
        return data.user;
    },

    async createRoom(name, nickname) {
        const { data, error } = await supabaseClient
            .rpc('create_calendar_room', {
                p_room_name: name,
                p_nickname: nickname
            })
            .single();
        if (error) throw error;
        return data;
    },

    async joinRoom(code, nickname) {
        const { data, error } = await supabaseClient
            .rpc('join_calendar_room', {
                p_room_code: code.trim().toUpperCase(),
                p_nickname: nickname
            })
            .single();
        if (error) throw error;
        return data;
    },

    async getRoom(code) {
        const { data, error } = await supabaseClient
            .from('rooms')
            .select('room_code, room_name, owner_id, finalized_date, schedule_start_date, schedule_end_date, created_at, last_activity_at')
            .eq('room_code', code)
            .single();
        if (error) throw error;
        return data;
    },

    async getSchedules(roomCode) {
        const { data, error } = await supabaseClient
            .from('schedules')
            .select('id, room_code, user_id, user_name, impossible_date, is_impossible, updated_at')
            .eq('room_code', roomCode)
            .eq('is_impossible', true)
            .order('impossible_date', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    async getParticipants(roomCode) {
        const { data, error } = await supabaseClient
            .from('participants')
            .select('id, room_code, user_id, nickname, joined_at, last_seen_at, is_complete, completed_at')
            .eq('room_code', roomCode)
            .order('joined_at', { ascending: true });
        if (error) throw error;
        return data || [];
    },

    async setSchedule(roomCode, userName, dateStr, isImpossible) {
        const { data: existing, error: selectError } = await supabaseClient
            .from('schedules')
            .select('id')
            .eq('room_code', roomCode)
            .eq('user_id', AppState.authUserId)
            .eq('impossible_date', dateStr)
            .limit(1)
            .maybeSingle();
        if (selectError) throw selectError;

        if (existing) {
            const { data, error } = await supabaseClient
                .from('schedules')
                .update({
                    is_impossible: isImpossible,
                    user_name: userName,
                    updated_at: new Date().toISOString()
                })
                .eq('id', existing.id)
                .select('id, room_code, user_id, user_name, impossible_date, is_impossible, updated_at')
                .single();
            if (error) throw error;
            return data;
        }

        const { data, error } = await supabaseClient
            .from('schedules')
            .insert({
                room_code: roomCode,
                user_id: AppState.authUserId,
                user_name: userName,
                impossible_date: dateStr,
                is_impossible: isImpossible
            })
            .select('id, room_code, user_id, user_name, impossible_date, is_impossible, updated_at')
            .single();
        if (error) throw error;
        return data;
    },

    async renameParticipant(roomCode, nickname) {
        const { error } = await supabaseClient.rpc('rename_my_participant', {
            p_room_code: roomCode,
            p_nickname: nickname
        });
        if (error) throw error;
    },

    async saveRoomSettings(roomCode, finalizedDate, startDate, endDate) {
        const { error } = await supabaseClient.rpc('set_calendar_settings', {
            p_room_code: roomCode,
            p_finalized_date: finalizedDate || null,
            p_schedule_start_date: startDate || null,
            p_schedule_end_date: endDate || null
        });
        if (error) throw error;
    },

    async setScheduleCompletion(roomCode, isComplete) {
        const { error } = await supabaseClient.rpc('set_my_schedule_completion', {
            p_room_code: roomCode,
            p_is_complete: isComplete
        });
        if (error) throw error;
    },

    async clearMySchedules(roomCode) {
        const { error } = await supabaseClient.rpc('clear_my_calendar_schedules', {
            p_room_code: roomCode
        });
        if (error) throw error;
    },

    async leaveRoom(roomCode) {
        const { error } = await supabaseClient.rpc('leave_calendar_room', {
            p_room_code: roomCode
        });
        if (error) throw error;
    }
};

function getErrorMessage(error, fallback) {
    const message = error?.message || '';
    if (message.includes('Anonymous sign-ins are disabled')) {
        return '익명 로그인이 아직 활성화되지 않았습니다.';
    }
    return message || fallback;
}

function showToast(message, icon = 'info') {
    const toast = document.getElementById('toast');
    document.getElementById('toast-message').innerText = message;
    document.getElementById('toast-icon').innerText = icon;
    toast.classList.remove('opacity-0', 'translate-y-24');
    toast.classList.add('opacity-100', 'translate-y-0');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
        toast.classList.remove('opacity-100', 'translate-y-0');
        toast.classList.add('opacity-0', 'translate-y-24');
    }, 3200);
}

function setButtonLoading(button, loading, text = '') {
    if (!button) return;
    if (loading) {
        button.dataset.originalHtml = button.innerHTML;
        button.disabled = true;
        button.innerHTML = `<span class="material-icons text-sm animate-spin">progress_activity</span>${text}`;
    } else {
        button.disabled = false;
        if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
    }
}

function setRealtimeStatus(status) {
    const badge = document.getElementById('realtime-badge');
    const label = document.getElementById('realtime-status');
    const headerBadge = document.getElementById('conn-badge');
    if (!badge || !label) return;
    const states = {
        SUBSCRIBED: ['bg-emerald-500', '실시간 연결됨'],
        CHANNEL_ERROR: ['bg-red-500', '실시간 연결 오류'],
        TIMED_OUT: ['bg-amber-500', '실시간 연결 지연'],
        CLOSED: ['bg-gray-500', '실시간 연결 종료'],
        PAUSED: ['bg-gray-500', '백그라운드에서 일시 중지']
    };
    const [color, text] = states[status] || ['bg-yellow-500', '실시간 연결 중'];
    badge.className = `w-2.5 h-2.5 shrink-0 rounded-full ${color} animate-pulse`;
    if (headerBadge) {
        headerBadge.className = `w-2 h-2 rounded-full ${color} animate-pulse`;
    }
    label.innerText = text;
}

function getParticipant(userId, fallbackName = '') {
    return AppState.loadedParticipants.find((person) => person.user_id === userId) ||
        { user_id: userId, nickname: fallbackName || '이전 참가자' };
}

function storeUserSession(nickname, roomCode) {
    localStorage.setItem('inverse_calendar_nick', nickname);
    AppState.user.nickname = nickname;
    AppState.user.roomCode = roomCode;
    document.getElementById('current-user-display').innerText =
        nickname;
    document.getElementById('user-info').classList.remove('hidden');
}

function updateRoomUrl(roomCode = '') {
    const url = new URL(window.location.href);
    if (roomCode) url.searchParams.set('room', roomCode);
    else url.searchParams.delete('room');
    window.history.replaceState({}, '', url);
}

function switchView(viewName) {
    AppState.currentView = viewName;
    const isLanding = viewName === 'landing';
    document.getElementById('view-landing').classList.toggle('hidden', !isLanding);
    document.getElementById('view-calendar').classList.toggle('hidden', isLanding);
    document.getElementById('user-info').classList.toggle('hidden', isLanding);
}

function openModal(id) {
    document.getElementById(id)?.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}

function closeModal(id) {
    document.getElementById(id)?.classList.add('hidden');
    if (!document.querySelector('.app-modal:not(.hidden)')) {
        document.body.classList.remove('overflow-hidden');
    }
}

async function fetchAndRenderAll(options = {}) {
    if (!AppState.user.roomCode) return false;
    try {
        const [room, schedules, participants] = await Promise.all([
            Database.getRoom(AppState.user.roomCode),
            Database.getSchedules(AppState.user.roomCode),
            Database.getParticipants(AppState.user.roomCode)
        ]);
        AppState.room = room;
        AppState.loadedSchedules = schedules;
        AppState.loadedParticipants = participants;
        renderAll();
        return true;
    } catch (error) {
        console.error('방 데이터 조회 실패:', error);
        if (!options.silent) {
            showToast(getErrorMessage(error, '일정을 불러오지 못했습니다.'), 'error');
        }
        return false;
    }
}

function upsertSchedule(row) {
    AppState.loadedSchedules = AppState.loadedSchedules.filter((schedule) =>
        schedule.id !== row.id &&
        !(
            schedule.user_id === row.user_id &&
            schedule.impossible_date === row.impossible_date
        )
    );
    if (row.is_impossible) AppState.loadedSchedules.push(row);
}

function markMyCompletionDirty() {
    const me = AppState.loadedParticipants.find(
        (person) => person.user_id === AppState.authUserId
    );
    if (!me?.is_complete) return;
    me.is_complete = false;
    me.completed_at = null;
}

function handleScheduleChange(payload) {
    const row = payload.new && Object.keys(payload.new).length
        ? payload.new
        : payload.old;
    if (!row) return;
    if (payload.eventType === 'DELETE' || row.is_impossible === false) {
        AppState.loadedSchedules = AppState.loadedSchedules.filter((schedule) =>
            schedule.id !== row.id
        );
    } else {
        upsertSchedule(row);
    }
    renderCalendar();
    renderParticipants();
    renderBestDates();
}

function handleParticipantChange(payload) {
    const row = payload.new && Object.keys(payload.new).length
        ? payload.new
        : payload.old;
    if (!row) return;
    if (row.user_id === AppState.authUserId && payload.eventType === 'DELETE') {
        showToast('방에서 나갔습니다.', 'logout');
        resetToLanding();
        return;
    }
    AppState.loadedParticipants = AppState.loadedParticipants.filter((person) =>
        person.user_id !== row.user_id
    );
    if (payload.eventType !== 'DELETE') AppState.loadedParticipants.push(row);
    if (row.user_id === AppState.authUserId && payload.eventType !== 'DELETE') {
        AppState.user.nickname = row.nickname;
        localStorage.setItem('inverse_calendar_nick', row.nickname);
    }
    renderParticipants();
    renderCalendar();
}

function scheduleCoalescedRefresh() {
    window.clearTimeout(AppState.realtimeRefreshTimer);
    AppState.realtimeRefreshTimer = window.setTimeout(() => {
        fetchAndRenderAll({ silent: true });
    }, 350);
}

function clearRealtimePauseTimer() {
    window.clearTimeout(AppState.realtimePauseTimer);
    AppState.realtimePauseTimer = null;
}

async function stopRealtime(status = 'CLOSED') {
    clearRealtimePauseTimer();
    AppState.realtimeSequence += 1;
    const channel = AppState.realtimeChannel;
    AppState.realtimeChannel = null;
    if (channel) await supabaseClient.removeChannel(channel);
    if (status) setRealtimeStatus(status);
}

async function subscribeToRoom() {
    if (!AppState.user.roomCode ||
        AppState.currentView !== 'calendar' ||
        document.hidden) return;

    clearRealtimePauseTimer();
    const sequence = ++AppState.realtimeSequence;
    const roomCode = AppState.user.roomCode;
    const previousChannel = AppState.realtimeChannel;
    AppState.realtimeChannel = null;
    if (previousChannel) await supabaseClient.removeChannel(previousChannel);
    if (sequence !== AppState.realtimeSequence || document.hidden) return;

    const channel = supabaseClient
        .channel(`shared-calendar-${roomCode}`)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'schedules',
            filter: `room_code=eq.${roomCode}`
        }, handleScheduleChange)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'participants',
            filter: `room_code=eq.${roomCode}`
        }, handleParticipantChange)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'rooms',
            filter: `room_code=eq.${roomCode}`
        }, (payload) => {
            if (payload.eventType === 'DELETE') {
                showToast('이 방이 삭제되었습니다.', 'delete');
                resetToLanding();
                return;
            }
            if (payload.new) {
                AppState.room = payload.new;
                renderRoomHeader();
                renderCalendar();
                renderFinalizedDate();
            } else {
                scheduleCoalescedRefresh();
            }
        })
        .subscribe((status) => {
            if (AppState.realtimeChannel === channel) setRealtimeStatus(status);
        });
    AppState.realtimeChannel = channel;
}

function scheduleRealtimePause() {
    clearRealtimePauseTimer();
    AppState.realtimePauseTimer = window.setTimeout(() => {
        if (document.hidden && AppState.realtimeChannel) {
            stopRealtime('PAUSED').catch(console.error);
        }
    }, 60000);
}

async function resumeRealtime() {
    clearRealtimePauseTimer();
    if (document.hidden || !AppState.user.roomCode ||
        AppState.currentView !== 'calendar') return;
    await fetchAndRenderAll({ silent: true });
    if (!AppState.realtimeChannel) await subscribeToRoom();
}

async function enterRoom(room, nickname) {
    AppState.room = room;
    storeUserSession(nickname, room.room_code);
    updateRoomUrl(room.room_code);
    switchView('calendar');
    await fetchAndRenderAll();
    await subscribeToRoom();
}

async function resetToLanding() {
    await stopRealtime(null);
    AppState.room = null;
    AppState.user.roomCode = '';
    AppState.loadedSchedules = [];
    AppState.loadedParticipants = [];
    updateRoomUrl('');
    switchView('landing');
}

function renderAll() {
    renderRoomHeader();
    renderCalendar();
    renderParticipants();
    renderBestDates();
    renderFinalizedDate();
}

function renderRoomHeader() {
    if (!AppState.room) return;
    document.getElementById('calendar-room-title').innerText = AppState.room.room_name;
    document.getElementById('calendar-room-code').innerText = AppState.room.room_code;
    document.getElementById('current-user-display').innerText =
        AppState.user.nickname;
}

function getYearMonthString(year, month) {
    return `${year}. ${String(month + 1).padStart(2, '0')}`;
}

function makeDateString(year, month, day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isDateInRange(dateString) {
    const startDate = AppState.room?.schedule_start_date;
    const endDate = AppState.room?.schedule_end_date;
    if (!startDate || !endDate) return true;
    return dateString >= startDate && dateString <= endDate;
}

function moveCalendarToDate(dateString) {
    if (!dateString) return;
    const [year, month] = dateString.split('-').map(Number);
    AppState.calendar.year = year;
    AppState.calendar.month = month - 1;
}

function getBusyPeople(dateString) {
    const seen = new Set();
    return AppState.loadedSchedules
        .filter((schedule) => schedule.impossible_date === dateString)
        .map((schedule) => getParticipant(schedule.user_id, schedule.user_name))
        .filter((person) => {
            const key = person.user_id || `legacy:${person.nickname}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function openDateDetail(dateString) {
    const people = getBusyPeople(dateString);
    document.getElementById('date-detail-title').innerText =
        `${dateString} 불가능한 사람`;
    const list = document.getElementById('date-detail-list');
    list.innerHTML = '';
    if (!people.length) {
        const empty = document.createElement('p');
        empty.className = 'text-sm text-emerald-400';
        empty.innerText = '모두 가능한 날입니다.';
        list.appendChild(empty);
    } else {
        people.forEach((person) => {
            const row = document.createElement('div');
            row.className = 'flex items-center gap-2 rounded-xl bg-gray-900 px-3 py-2';
            const icon = document.createElement('span');
            icon.className = 'material-icons text-red-400 text-base';
            icon.innerText = 'person_off';
            const name = document.createElement('span');
            name.className = 'text-sm text-gray-200';
            name.innerText = person.nickname;
            row.append(icon, name);
            list.appendChild(row);
        });
    }
    openModal('modal-date-detail');
}

async function toggleDate(dateString) {
    if (AppState.pendingDates.has(dateString)) return;
    AppState.pendingDates.add(dateString);
    const existing = AppState.loadedSchedules.find((schedule) =>
        schedule.user_id === AppState.authUserId &&
        schedule.impossible_date === dateString
    );
    const nextValue = !existing;
    markMyCompletionDirty();
    if (existing) {
        AppState.loadedSchedules = AppState.loadedSchedules.filter((schedule) =>
            schedule !== existing
        );
    } else {
        AppState.loadedSchedules.push({
            id: `optimistic-${dateString}`,
            room_code: AppState.user.roomCode,
            user_id: AppState.authUserId,
            user_name: AppState.user.nickname,
            impossible_date: dateString,
            is_impossible: true
        });
    }
    renderCalendar();
    renderParticipants();
    renderBestDates();

    try {
        const saved = await Database.setSchedule(
            AppState.user.roomCode,
            AppState.user.nickname,
            dateString,
            nextValue
        );
        upsertSchedule(saved);
        renderCalendar();
        renderParticipants();
        renderBestDates();
    } catch (error) {
        console.error('일정 변경 실패:', error);
        showToast(getErrorMessage(error, '일정 변경에 실패했습니다.'), 'error');
        await fetchAndRenderAll({ silent: true });
    } finally {
        AppState.pendingDates.delete(dateString);
    }
}

function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const { year, month } = AppState.calendar;
    const startDayOfWeek = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < startDayOfWeek; i += 1) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'aspect-square invisible select-none';
        grid.appendChild(emptyCell);
    }

    const todayString = makeDateString(
        new Date().getFullYear(),
        new Date().getMonth(),
        new Date().getDate()
    );

    for (let day = 1; day <= totalDays; day += 1) {
        const dateString = makeDateString(year, month, day);
        const isInRange = isDateInRange(dateString);
        const people = getBusyPeople(dateString);
        const isMine = AppState.loadedSchedules.some((schedule) =>
            schedule.user_id === AppState.authUserId &&
            schedule.impossible_date === dateString
        );
        const isFinalized = AppState.room?.finalized_date === dateString;
        const isToday = dateString === todayString;
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.dataset.date = dateString;
        cell.className = 'group relative aspect-square min-w-0 rounded-lg sm:rounded-xl border p-1.5 sm:p-2 text-left transition focus:z-50 focus:outline-none select-none touch-manipulation flex flex-col';

        if (!isInRange) {
            cell.className += ' cursor-not-allowed border-gray-900 bg-gray-950/80 opacity-45';
            cell.disabled = true;
        } else if (people.length === 0) {
            cell.className += ' bg-gray-900/45 hover:z-50 hover:-translate-y-0.5 border-emerald-800/60 hover:border-emerald-500/70 hover:bg-emerald-950/25';
        } else if (people.length === 1) {
            cell.className += ' bg-gray-900/45 hover:z-50 hover:-translate-y-0.5 border-amber-800/60 hover:border-amber-500/70 hover:bg-amber-950/25';
        } else {
            cell.className += ' bg-gray-900/45 hover:z-50 hover:-translate-y-0.5 border-rose-800/60 hover:border-rose-500/70 hover:bg-rose-950/25';
        }
        if (isToday) cell.className += ' shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)]';
        if (isFinalized) cell.className += ' outline outline-2 outline-offset-2 outline-violet-400';

        const dayNumber = document.createElement('span');
        dayNumber.className = `text-xs sm:text-sm md:text-base font-bold leading-none ${
            !isInRange ? 'text-gray-700' :
            people.length >= 2 ? 'text-red-400' :
            people.length === 1 ? 'text-amber-400' : 'text-emerald-400'
        }`;
        dayNumber.innerText = day;

        const statusTag = document.createElement('span');
        statusTag.className = 'mt-auto block max-w-full truncate text-[8px] sm:text-[9px] md:text-[10px] font-medium text-gray-500';
        statusTag.innerText = !isInRange
            ? '범위 밖'
            : people.length
            ? `${people.length}명 불가`
            : '가능';
        cell.append(dayNumber, statusTag);

        if (isFinalized && isInRange) {
            const finalBadge = document.createElement('span');
            finalBadge.className = 'absolute right-1 top-1 rounded-full bg-violet-500 px-1.5 py-0.5 text-[7px] font-bold text-white shadow-lg';
            finalBadge.innerText = '약속';
            cell.appendChild(finalBadge);
        }

        if (isMine && isInRange) {
            const mineIndicator = document.createElement('span');
            mineIndicator.className = 'absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-indigo-400 ring-2 ring-indigo-500/20';
            mineIndicator.title = '내가 불가능한 날로 선택';
            cell.appendChild(mineIndicator);
        }

        if (people.length && isInRange) {
            const tooltip = document.createElement('span');
            const columnIndex = (startDayOfWeek + day - 1) % 7;
            const horizontalPosition = columnIndex === 0 ? 'left-0' :
                columnIndex === 6 ? 'right-0' : 'left-1/2 -translate-x-1/2';
            tooltip.className = `pointer-events-none absolute top-full z-50 mt-2 hidden w-max max-w-[16rem] whitespace-normal rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-[11px] font-medium leading-relaxed text-gray-100 shadow-2xl md:group-hover:block group-focus-visible:block ${horizontalPosition}`;
            tooltip.innerText = `불가능: ${people.map((person) => person.nickname).join(', ')}`;
            cell.appendChild(tooltip);
        }

        if (isInRange) {
            let longPressed = false;
            let longPressTimer = null;
            cell.addEventListener('pointerdown', () => {
                longPressed = false;
                longPressTimer = window.setTimeout(() => {
                    longPressed = true;
                    openDateDetail(dateString);
                }, 550);
            });
            ['pointerup', 'pointercancel', 'pointerleave'].forEach((eventName) => {
                cell.addEventListener(eventName, () => window.clearTimeout(longPressTimer));
            });
            cell.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                openDateDetail(dateString);
            });
            cell.addEventListener('click', (event) => {
                if (longPressed) {
                    event.preventDefault();
                    longPressed = false;
                    return;
                }
                toggleDate(dateString);
            });
        }
        cell.setAttribute(
            'aria-label',
            !isInRange
                ? `${day}일, 조율 범위 밖`
                : `${day}일, ${people.length ? `${people.length}명 불가능` : '모두 가능'}. 길게 누르면 명단 보기`
        );
        grid.appendChild(cell);
    }
    document.getElementById('calendar-year-month').innerText =
        getYearMonthString(year, month);
}

function renderParticipants() {
    const list = document.getElementById('participants-list');
    if (!list) return;
    list.innerHTML = '';
    const participants = [...AppState.loadedParticipants].sort((a, b) => {
        if (a.user_id === AppState.authUserId) return -1;
        if (b.user_id === AppState.authUserId) return 1;
        return new Date(a.joined_at) - new Date(b.joined_at);
    });
    participants.forEach((person) => {
        const isMe = person.user_id === AppState.authUserId;
        const unavailableDays = new Set(
            AppState.loadedSchedules
                .filter((schedule) => schedule.user_id === person.user_id)
                .map((schedule) => schedule.impossible_date)
        ).size;
        const row = document.createElement('div');
        row.className = `flex items-center justify-between gap-2 rounded-xl border p-2.5 ${
            person.is_complete
                ? 'border-emerald-900/60 bg-emerald-950/20'
                : 'border-gray-800/80 bg-gray-900'
        }`;
        const label = document.createElement('span');
        label.className = `min-w-0 truncate text-xs font-semibold ${isMe ? 'text-indigo-400' : 'text-gray-300'}`;
        label.innerText = `${person.nickname}${isMe ? ' (나)' : ''}`;
        const badges = document.createElement('div');
        badges.className = 'flex shrink-0 items-center gap-1.5';
        const completionBadge = document.createElement('span');
        completionBadge.className = `inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[9px] font-bold ${
            person.is_complete
                ? 'border-emerald-800/70 bg-emerald-950/60 text-emerald-400'
                : 'border-gray-700 bg-gray-800 text-gray-500'
        }`;
        completionBadge.innerHTML = person.is_complete
            ? '<span class="material-icons text-[11px]">check</span>완료'
            : '입력 중';
        const badge = document.createElement('span');
        badge.className = 'shrink-0 bg-gray-800 border border-gray-700 text-gray-400 font-semibold text-[10px] px-2 py-0.5 rounded-md';
        badge.innerText = `안됨 ${unavailableDays}일`;
        badges.append(completionBadge, badge);
        row.append(label, badges);
        list.appendChild(row);
    });
    const completedCount = participants.filter((person) => person.is_complete).length;
    document.getElementById('participant-count').innerText =
        `${participants.length}/50`;
    document.getElementById('completion-count').innerText =
        `${completedCount}/${participants.length}명 완료`;

    const me = participants.find((person) => person.user_id === AppState.authUserId);
    const completionButton = document.getElementById('btn-toggle-complete');
    if (me?.is_complete) {
        completionButton.className = 'mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-800/70 bg-emerald-950/50 py-2.5 text-xs font-bold text-emerald-400 transition hover:bg-emerald-950/80';
        completionButton.innerHTML = '<span class="material-icons text-sm">check_circle</span>입력 완료됨 · 다시 수정';
        completionButton.setAttribute('aria-pressed', 'true');
    } else {
        completionButton.className = 'mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-500';
        completionButton.innerHTML = '<span class="material-icons text-sm">task_alt</span>일정 입력 완료';
        completionButton.setAttribute('aria-pressed', 'false');
    }

    const myScheduleCount = new Set(
        AppState.loadedSchedules
            .filter((schedule) => schedule.user_id === AppState.authUserId)
            .map((schedule) => schedule.impossible_date)
    ).size;
    const clearButton = document.getElementById('btn-clear-my-schedule');
    clearButton.disabled = myScheduleCount === 0;
    clearButton.classList.toggle('opacity-40', myScheduleCount === 0);
    clearButton.classList.toggle('cursor-not-allowed', myScheduleCount === 0);
    document.getElementById('my-schedule-count').innerText =
        myScheduleCount ? `선택한 ${myScheduleCount}일 모두 지우기` : '지울 일정 없음';
}

function renderBestDates() {
    const container = document.getElementById('best-dates-list');
    if (!container) return;
    container.innerHTML = '';
    const { year, month } = AppState.calendar;
    const totalDays = new Date(year, month + 1, 0).getDate();
    const today = makeDateString(
        new Date().getFullYear(),
        new Date().getMonth(),
        new Date().getDate()
    );
    const ranked = [];
    for (let day = 1; day <= totalDays; day += 1) {
        const date = makeDateString(year, month, day);
        if (date < today || !isDateInRange(date)) continue;
        ranked.push({ date, count: getBusyPeople(date).length });
    }
    ranked.sort((a, b) => a.count - b.count || a.date.localeCompare(b.date));
    ranked.slice(0, 3).forEach((item, index) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'flex w-full items-center justify-between rounded-xl bg-gray-900 px-3 py-2 text-left hover:bg-gray-800 transition';
        const date = document.createElement('span');
        date.className = 'text-xs font-semibold text-gray-200';
        date.innerText = `${index + 1}. ${item.date.slice(5).replace('-', '/')} (${['일','월','화','수','목','금','토'][new Date(`${item.date}T12:00:00`).getDay()]})`;
        const count = document.createElement('span');
        count.className = `text-[10px] font-bold ${item.count ? 'text-amber-400' : 'text-emerald-400'}`;
        count.innerText = item.count ? `불가 ${item.count}명` : '모두 가능';
        row.append(date, count);
        row.addEventListener('click', () => openDateDetail(item.date));
        container.appendChild(row);
    });
    if (!ranked.length) {
        container.innerHTML = '<p class="text-xs text-gray-500">다음 달로 이동해 추천 날짜를 확인하세요.</p>';
    }
}

function renderFinalizedDate() {
    const label = document.getElementById('finalized-date-display');
    if (!label) return;
    if (AppState.room?.finalized_date) {
        label.innerText = AppState.room.finalized_date;
        label.className = 'text-sm font-bold text-violet-300';
    } else {
        label.innerText = '아직 확정되지 않았어요';
        label.className = 'text-xs text-gray-500';
    }
}

function openRoomSettings() {
    document.getElementById('input-settings-final-date').value =
        AppState.room.finalized_date || '';
    document.getElementById('input-settings-start-date').value =
        AppState.room.schedule_start_date || '';
    document.getElementById('input-settings-end-date').value =
        AppState.room.schedule_end_date || '';
    openModal('modal-room-settings');
}

async function joinFromForm(options = {}) {
    const nickname = document.getElementById('input-nickname').value.trim();
    const roomCode = document.getElementById('input-room-code').value.trim().toUpperCase();
    const button = document.getElementById('btn-submit-join');
    if (!nickname) {
        if (!options.quiet) showToast('닉네임을 먼저 입력해 주세요.', 'warning');
        return;
    }
    if (roomCode.length !== 6) {
        if (!options.quiet) showToast('유효한 6자리 초대 코드를 입력해 주세요.', 'warning');
        return;
    }
    setButtonLoading(button, true, '입장 중');
    try {
        const room = await Database.joinRoom(roomCode, nickname);
        await enterRoom(room, nickname);
        if (!options.quiet) showToast(`'${room.room_name}' 방에 참가했습니다!`, 'check_circle');
    } catch (error) {
        console.error('방 입장 실패:', error);
        showToast(getErrorMessage(error, '방 정보를 확인하지 못했습니다.'), 'error');
    } finally {
        setButtonLoading(button, false);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const savedNick = localStorage.getItem('inverse_calendar_nick');
    if (savedNick) document.getElementById('input-nickname').value = savedNick;
    const invitedRoomCode = new URL(window.location.href).searchParams.get('room');
    if (invitedRoomCode) {
        document.getElementById('input-room-code').value =
            invitedRoomCode.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 6);
    }

    try {
        const user = await Database.ensureAnonymousSession();
        AppState.authUserId = user.id;
        document.getElementById('auth-loading').classList.add('hidden');
        if (invitedRoomCode && savedNick) await joinFromForm({ quiet: true });
    } catch (error) {
        console.error('익명 로그인 실패:', error);
        document.getElementById('auth-loading').innerText =
            getErrorMessage(error, '서비스 연결에 실패했습니다.');
        showToast(getErrorMessage(error, '서비스 연결에 실패했습니다.'), 'error');
    }

    document.getElementById('tab-join').addEventListener('click', (event) => {
        document.getElementById('form-join').classList.remove('hidden');
        document.getElementById('form-create').classList.add('hidden');
        event.currentTarget.className = 'py-2.5 text-sm font-semibold rounded-lg bg-gray-800 text-white shadow-sm transition';
        document.getElementById('tab-create').className = 'py-2.5 text-sm font-semibold rounded-lg text-gray-400 hover:text-white transition';
    });
    document.getElementById('tab-create').addEventListener('click', (event) => {
        document.getElementById('form-create').classList.remove('hidden');
        document.getElementById('form-join').classList.add('hidden');
        event.currentTarget.className = 'py-2.5 text-sm font-semibold rounded-lg bg-gray-800 text-white shadow-sm transition';
        document.getElementById('tab-join').className = 'py-2.5 text-sm font-semibold rounded-lg text-gray-400 hover:text-white transition';
    });
    document.getElementById('input-room-code').addEventListener('input', (event) => {
        event.target.value = event.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '');
    });
    document.getElementById('btn-submit-join').addEventListener('click', () => joinFromForm());
    document.getElementById('input-room-code').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') joinFromForm();
    });

    document.getElementById('btn-submit-create').addEventListener('click', async () => {
        const nickname = document.getElementById('input-nickname').value.trim();
        const roomName = document.getElementById('input-room-name').value.trim();
        const button = document.getElementById('btn-submit-create');
        if (!nickname) return showToast('닉네임을 먼저 입력해 주세요.', 'warning');
        if (!roomName) return showToast('모임 이름을 적어주세요.', 'warning');
        setButtonLoading(button, true, '생성 중');
        try {
            const room = await Database.createRoom(roomName, nickname);
            await enterRoom(room, nickname);
            showToast(`초대 코드 ${room.room_code} 방을 개설했습니다!`, 'check_circle');
        } catch (error) {
            console.error('방 생성 실패:', error);
            showToast(getErrorMessage(error, '방 생성에 실패했습니다.'), 'error');
        } finally {
            setButtonLoading(button, false);
        }
    });

    document.getElementById('copy-code-container').addEventListener('click', async () => {
        const inviteUrl = new URL(window.location.origin);
        inviteUrl.searchParams.set('room', AppState.user.roomCode);
        try {
            await navigator.clipboard.writeText(inviteUrl.toString());
            showToast('초대 링크가 복사되었습니다!', 'link');
        } catch {
            showToast(`초대 코드: ${AppState.user.roomCode}`, 'info');
        }
    });
    document.getElementById('btn-share-room').addEventListener('click', async () => {
        const inviteUrl = new URL(window.location.origin);
        inviteUrl.searchParams.set('room', AppState.user.roomCode);
        const shareData = { title: AppState.room.room_name, text: '공유 캘린더에 참여해 주세요.', url: inviteUrl.toString() };
        try {
            if (navigator.share) await navigator.share(shareData);
            else {
                await navigator.clipboard.writeText(inviteUrl.toString());
                showToast('초대 링크가 복사되었습니다!', 'link');
            }
        } catch (error) {
            if (error.name !== 'AbortError') showToast('공유하지 못했습니다.', 'error');
        }
    });

    document.getElementById('btn-prev-month').addEventListener('click', () => {
        if (AppState.calendar.month === 0) {
            AppState.calendar.month = 11;
            AppState.calendar.year -= 1;
        } else AppState.calendar.month -= 1;
        renderCalendar();
        renderBestDates();
    });
    document.getElementById('btn-next-month').addEventListener('click', () => {
        if (AppState.calendar.month === 11) {
            AppState.calendar.month = 0;
            AppState.calendar.year += 1;
        } else AppState.calendar.month += 1;
        renderCalendar();
        renderBestDates();
    });
    document.getElementById('btn-refresh-calendar').addEventListener('click', async () => {
        const success = await fetchAndRenderAll();
        if (!document.hidden && !AppState.realtimeChannel) await subscribeToRoom();
        if (success) showToast('일정을 새로고침했습니다.', 'refresh');
    });
    document.getElementById('btn-toggle-complete').addEventListener('click', async () => {
        const button = document.getElementById('btn-toggle-complete');
        const me = AppState.loadedParticipants.find(
            (person) => person.user_id === AppState.authUserId
        );
        const nextValue = !me?.is_complete;
        setButtonLoading(button, true, nextValue ? '완료 처리 중' : '수정 상태로 변경 중');
        try {
            await Database.setScheduleCompletion(AppState.user.roomCode, nextValue);
            await fetchAndRenderAll({ silent: true });
            showToast(
                nextValue ? '일정 입력을 완료했습니다.' : '다시 수정할 수 있어요.',
                nextValue ? 'task_alt' : 'edit_calendar'
            );
        } catch (error) {
            showToast(getErrorMessage(error, '완료 상태 변경에 실패했습니다.'), 'error');
        } finally {
            setButtonLoading(button, false);
            renderParticipants();
        }
    });
    document.getElementById('btn-clear-my-schedule').addEventListener('click', async () => {
        const myScheduleCount = new Set(
            AppState.loadedSchedules
                .filter((schedule) => schedule.user_id === AppState.authUserId)
                .map((schedule) => schedule.impossible_date)
        ).size;
        if (!myScheduleCount) return;
        if (!window.confirm(`내가 표시한 ${myScheduleCount}일을 모두 지울까요? 이 작업은 되돌릴 수 없습니다.`)) return;

        const button = document.getElementById('btn-clear-my-schedule');
        setButtonLoading(button, true, '초기화 중');
        try {
            await Database.clearMySchedules(AppState.user.roomCode);
            await fetchAndRenderAll({ silent: true });
            showToast('내 일정을 모두 초기화했습니다.', 'restart_alt');
        } catch (error) {
            showToast(getErrorMessage(error, '일정 초기화에 실패했습니다.'), 'error');
        } finally {
            setButtonLoading(button, false);
            renderParticipants();
        }
    });
    document.getElementById('btn-back-to-landing').addEventListener('click', async () => {
        await resetToLanding();
        document.getElementById('input-room-code').value = '';
        document.getElementById('form-join').classList.remove('hidden');
        document.getElementById('form-create').classList.add('hidden');
        document.getElementById('tab-join').className =
            'py-2.5 text-sm font-semibold rounded-lg bg-gray-800 text-white shadow-sm transition';
        document.getElementById('tab-create').className =
            'py-2.5 text-sm font-semibold rounded-lg text-gray-400 hover:text-white transition';
        document.getElementById('input-room-code').focus();
        showToast('방 정보는 그대로 유지됩니다. 다른 초대 코드를 입력하세요.', 'meeting_room');
    });
    document.getElementById('btn-edit-nickname').addEventListener('click', () => {
        document.getElementById('input-edit-nickname').value = AppState.user.nickname;
        openModal('modal-nickname');
    });
    document.getElementById('btn-save-nickname').addEventListener('click', async () => {
        const nickname = document.getElementById('input-edit-nickname').value.trim();
        if (!nickname) return showToast('닉네임을 입력해 주세요.', 'warning');
        try {
            await Database.renameParticipant(AppState.user.roomCode, nickname);
            AppState.user.nickname = nickname;
            localStorage.setItem('inverse_calendar_nick', nickname);
            await fetchAndRenderAll({ silent: true });
            closeModal('modal-nickname');
            showToast('닉네임을 변경했습니다.', 'edit');
        } catch (error) {
            showToast(getErrorMessage(error, '닉네임 변경에 실패했습니다.'), 'error');
        }
    });
    document.getElementById('btn-room-settings').addEventListener('click', openRoomSettings);
    document.getElementById('btn-save-room-settings').addEventListener('click', async () => {
        const finalizedDate = document.getElementById('input-settings-final-date').value;
        const startDate = document.getElementById('input-settings-start-date').value;
        const endDate = document.getElementById('input-settings-end-date').value;
        if ((startDate && !endDate) || (!startDate && endDate)) {
            return showToast('조율 시작일과 종료일을 모두 입력해 주세요.', 'warning');
        }
        if (startDate && startDate > endDate) {
            return showToast('종료일은 시작일보다 빠를 수 없습니다.', 'warning');
        }
        if (finalizedDate && startDate &&
            (finalizedDate < startDate || finalizedDate > endDate)) {
            return showToast('최종 약속일은 조율 범위 안에 있어야 합니다.', 'warning');
        }
        try {
            await Database.saveRoomSettings(
                AppState.user.roomCode,
                finalizedDate,
                startDate,
                endDate
            );
            await fetchAndRenderAll({ silent: true });
            if (startDate) {
                moveCalendarToDate(startDate);
                renderCalendar();
                renderBestDates();
            }
            closeModal('modal-room-settings');
            showToast('일정 설정을 저장했습니다.', 'event_available');
        } catch (error) {
            showToast(getErrorMessage(error, '일정 설정에 실패했습니다.'), 'error');
        }
    });
    document.getElementById('btn-leave-room').addEventListener('click', async () => {
        if (!window.confirm('이 방에서 나갈까요? 내가 표시한 일정도 삭제됩니다.')) return;
        try {
            await Database.leaveRoom(AppState.user.roomCode);
            await resetToLanding();
            showToast('방에서 나왔습니다.', 'logout');
        } catch (error) {
            showToast(getErrorMessage(error, '방 나가기에 실패했습니다.'), 'error');
        }
    });

    document.querySelectorAll('[data-close-modal]').forEach((button) => {
        button.addEventListener('click', () => closeModal(button.dataset.closeModal));
    });
    document.querySelectorAll('.app-modal').forEach((modal) => {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeModal(modal.id);
        });
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) scheduleRealtimePause();
        else resumeRealtime().catch((error) => {
            console.error('실시간 연결 재개 실패:', error);
            setRealtimeStatus('CHANNEL_ERROR');
        });
    });
    window.addEventListener('pagehide', () => {
        clearRealtimePauseTimer();
        if (AppState.realtimeChannel) {
            supabaseClient.removeChannel(AppState.realtimeChannel);
            AppState.realtimeChannel = null;
        }
    });

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch((error) => {
            console.warn('서비스 워커 등록 실패:', error);
        });
    }
});
