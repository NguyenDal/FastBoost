const TIME_ZONE = 'America/Winnipeg';
const partsFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

function earningsMonth(date = new Date()) {
    const parts = Object.fromEntries(partsFormatter.formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}`;
}

function parseMonth(month) {
    if (typeof month !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw Object.assign(new Error('Choose a valid calendar month.'), { status: 400 });
    const [year, number] = month.split('-').map(Number);
    if (year < 2000 || year > 9998) throw Object.assign(new Error('Choose a valid calendar month.'), { status: 400 });
    return { year, number };
}

function monthStart(year, number) {
    const target = Date.UTC(year, number - 1, 1);
    let instant = target;
    for (let step = 0; step < 2; step++) {
        const p = Object.fromEntries(partsFormatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
        const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
        instant += target - local;
    }
    return new Date(instant);
}

function monthPeriod(month, now = new Date()) {
    const { year, number } = parseMonth(month);
    const startsAt = monthStart(year, number);
    const endsAt = monthStart(number === 12 ? year + 1 : year, number === 12 ? 1 : number + 1);
    return { month, label: new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: 'long', year: 'numeric' }).format(startsAt), startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), closed: endsAt <= now };
}

function previousMonth(month) {
    const { year, number } = parseMonth(month);
    return `${number === 1 ? year - 1 : year}-${String(number === 1 ? 12 : number - 1).padStart(2, '0')}`;
}

module.exports = { TIME_ZONE, earningsMonth, monthPeriod, previousMonth };
