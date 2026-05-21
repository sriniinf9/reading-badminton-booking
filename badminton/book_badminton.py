import os
import re
import sys
import time
from datetime import datetime, timedelta

import requests
from bs4 import BeautifulSoup

# Load .env from the project root so the script works when run directly too
def _load_dotenv() -> None:
    env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
    try:
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                key, val = line.split('=', 1)
                os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass

_load_dotenv()

BASE_URL          = os.environ.get('BOOKING_URL', 'https://bookings.better.org.uk')
EMAIL             = os.environ['BETTER_EMAIL']
PASSWORD          = os.environ['BETTER_PASSWORD']
LOCATION_1        = os.environ.get('LOCATION_1', 'rivermead-leisure-complex')
LOCATION_2        = os.environ.get('LOCATION_2', 'meadway-sports-centre')
LOC1_NAME         = os.environ.get('LOCATION_1_NAME', 'Rivermead Leisure Centre')
LOC2_NAME         = os.environ.get('LOCATION_2_NAME', 'Meadway Leisure Centre')
BOOKING_OPEN_HOUR = int(os.environ.get('BOOKING_OPEN_HOUR', '22'))
BOOKING_OPEN_MIN  = int(os.environ.get('BOOKING_OPEN_MINUTE', '0'))
RETRY_ATTEMPTS    = int(os.environ.get('SLOT_RETRY_ATTEMPTS', '3'))
RETRY_DELAY_S     = int(os.environ.get('SLOT_RETRY_DELAY_MS', '30000')) // 1000

HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    ),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-GB,en;q=0.9',
}

TIMETABLE_SLUGS_40MIN = ['badminton-40min', 'badminton-sessions']
TIMETABLE_SLUGS_60MIN = ['badminton-60min', 'badminton-sessions']


def get_target_date() -> datetime:
    return datetime.now() + timedelta(days=7)


def is_weekend(date: datetime) -> bool:
    return date.weekday() >= 5


def wait_until_booking_opens() -> None:
    now = datetime.now()
    open_time = now.replace(hour=BOOKING_OPEN_HOUR, minute=BOOKING_OPEN_MIN, second=2, microsecond=0)
    wait_secs = (open_time - now).total_seconds()
    if 0 < wait_secs <= 10 * 60:
        print(f'Waiting {int(wait_secs)}s for booking window at '
              f'{BOOKING_OPEN_HOUR:02d}:{BOOKING_OPEN_MIN:02d}…')
        time.sleep(wait_secs)
        print('Booking window open — attempting now.')


def make_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(HEADERS)
    session.cookies.set(
        'OptanonAlertBoxClosed',
        datetime.now().isoformat(),
        domain='bookings.better.org.uk',
    )
    return session


def _csrf(soup: BeautifulSoup) -> str | None:
    meta = soup.find('meta', {'name': re.compile(r'csrf.token', re.I)})
    if meta:
        return meta.get('content')
    inp = soup.find('input', {'name': re.compile(r'csrf|_token|authenticity_token', re.I)})
    if inp:
        return inp.get('value')
    return None


def login(session: requests.Session) -> None:
    r = session.get(f'{BASE_URL}/')
    r.raise_for_status()
    soup = BeautifulSoup(r.text, 'html.parser')
    csrf = _csrf(soup)

    # NextAuth credentials flow (Next.js apps)
    try:
        cr = session.get(f'{BASE_URL}/api/auth/csrf', timeout=10)
        if cr.status_code == 200:
            csrf = cr.json().get('csrfToken', csrf)
    except Exception:
        pass

    payload: dict = {'email': EMAIL, 'password': PASSWORD, 'callbackUrl': BASE_URL}
    if csrf:
        payload['csrfToken'] = csrf

    session.post(
        f'{BASE_URL}/api/auth/signin/credentials',
        data={**payload, 'json': 'true'},
        allow_redirects=True,
        timeout=20,
    )

    # Verify session
    r = session.get(f'{BASE_URL}/', timeout=15)
    soup = BeautifulSoup(r.text, 'html.parser')
    authenticated = bool(
        soup.find(string=re.compile(r'log out|sign out|my account|hi,', re.I)) or
        soup.find(attrs={'data-testid': re.compile(r'user|account|logout', re.I)})
    )
    if not authenticated:
        raise RuntimeError('Login failed — could not verify authenticated session')
    print('Logged in successfully')


def get_timetable(session: requests.Session, location_slug: str, date: datetime, slugs: list[str] | None = None) -> tuple[str, str]:
    """Return (html, final_url) for the first working timetable URL."""
    date_str = date.strftime('%Y-%m-%d')
    for slug in (slugs or TIMETABLE_SLUGS_40MIN):
        url = f'{BASE_URL}/location/{location_slug}/{slug}/{date_str}/by-time'
        print(f'Trying timetable URL: /location/{location_slug}/{slug}/{date_str}/by-time')
        try:
            r = session.get(url, timeout=20, allow_redirects=True)
        except requests.RequestException as e:
            print(f'  Request failed: {e}')
            continue
        if date_str not in r.url:
            print(f'  Redirected away — got: {r.url}')
            continue
        if re.search(r"gone offside|doesn't exist|not found|404", r.text, re.I):
            print(f'  404 page — skipping')
            continue
        print(f'Timetable loaded: {r.url}')
        return r.text, r.url
    raise RuntimeError(f'No working timetable URL found for {location_slug} on {date_str}')


def find_slots(html: str, time_from: str, time_to: str, court_pref: str | None) -> list[str]:
    """Return href paths for slots whose start time falls within [time_from, time_to]."""
    soup = BeautifulSoup(html, 'html.parser')
    from_h, from_m = map(int, time_from.split(':'))
    to_h, to_m     = map(int, time_to.split(':'))
    from_mins = from_h * 60 + from_m
    to_mins   = to_h   * 60 + to_m

    results: list[str] = []
    for a in soup.find_all('a', href=re.compile(r'/slot/')):
        href = a['href']
        # href format: /location/.../slot/HH:MM-HH:MM/<id>
        m = re.search(r'/slot/(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/', href)
        if not m:
            continue
        sh, sm = map(int, m.group(1).split(':'))
        slot_start = sh * 60 + sm
        # Accept slots whose START TIME is anywhere in [from, to]
        if slot_start < from_mins or slot_start > to_mins:
            continue
        if court_pref and court_pref.lower() not in (a.get_text() or '').lower():
            continue
        results.append(href)

    # Retry without court preference if nothing matched
    if not results and court_pref:
        print(f'No "{court_pref}" slot found, retrying without court preference…')
        return find_slots(html, time_from, time_to, None)

    return results


def book_slot(session: requests.Session, slot_href: str) -> str:
    url = slot_href if slot_href.startswith('http') else f'{BASE_URL}{slot_href}'
    r = session.get(url, timeout=20, allow_redirects=True)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, 'html.parser')

    # Find "Add to basket" form/button
    form = soup.find('form', string=re.compile(r'add to basket|add to cart|book', re.I))
    if not form:
        form = soup.find('form', action=re.compile(r'basket|cart|book', re.I))
    if not form:
        # Try button inside any form
        btn = soup.find('button', string=re.compile(r'add to basket|add to cart|book', re.I))
        if btn:
            form = btn.find_parent('form')

    if not form:
        raise RuntimeError(f'Could not find basket form on slot page: {r.url}')

    action = form.get('action', '')
    action_url = action if action.startswith('http') else f'{BASE_URL}{action}'
    method = (form.get('method') or 'post').lower()
    data = {inp['name']: inp.get('value', '') for inp in form.find_all('input', attrs={'name': True})}

    fn = session.post if method == 'post' else session.get
    r = fn(action_url, data=data, timeout=20, allow_redirects=True)
    r.raise_for_status()
    print('Added to basket')

    m = re.search(r'/slot/(\d{1,2}:\d{2})', slot_href)
    return m.group(1) if m else slot_href


def checkout(session: requests.Session) -> None:
    r = session.get(f'{BASE_URL}/basket', timeout=20, allow_redirects=True)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, 'html.parser')

    form = soup.find('form', action=re.compile(r'checkout|payment', re.I))
    if not form:
        btn = soup.find('button', string=re.compile(r'checkout|proceed', re.I))
        if btn:
            form = btn.find_parent('form')

    if not form:
        raise RuntimeError('Could not find checkout form in basket page')

    action = form.get('action', '/checkout')
    action_url = action if action.startswith('http') else f'{BASE_URL}{action}'
    method = (form.get('method') or 'post').lower()
    data = {inp['name']: inp.get('value', '') for inp in form.find_all('input', attrs={'name': True})}

    fn = session.post if method == 'post' else session.get
    r = fn(action_url, data=data, timeout=20, allow_redirects=True)
    r.raise_for_status()
    print('Proceeding to checkout')


def confirm_booking(session: requests.Session) -> str:
    r = session.get(session.get_redirect_target() if hasattr(session, 'get_redirect_target') else f'{BASE_URL}/checkout', timeout=20, allow_redirects=True)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, 'html.parser')

    # Tick any unchecked required checkboxes (T&Cs) if they appear in a form
    confirm_form = None
    for form in soup.find_all('form'):
        btn = form.find('button', string=re.compile(r'confirm|pay now|complete', re.I))
        if btn:
            confirm_form = form
            break

    if not confirm_form:
        raise RuntimeError('Could not find confirmation form on checkout page')

    action = confirm_form.get('action', '')
    action_url = action if action.startswith('http') else f'{BASE_URL}{action}'
    method = (confirm_form.get('method') or 'post').lower()
    data = {inp['name']: inp.get('value', '') for inp in confirm_form.find_all('input', attrs={'name': True})}

    fn = session.post if method == 'post' else session.get
    r = fn(action_url, data=data, timeout=30, allow_redirects=True)
    r.raise_for_status()

    if not re.search(r'booking confirmed|booking successful|thank you', r.text, re.I):
        raise RuntimeError('Confirmation page not reached after form submit')

    soup = BeautifulSoup(r.text, 'html.parser')
    ref_tag = soup.find(attrs={'class': re.compile(r'booking.ref|confirmation.number', re.I)})
    ref = ref_tag.get_text(strip=True) if ref_tag else 'N/A'
    print(f'Booking confirmed! Reference: {ref}')
    return ref


def run() -> None:
    target_date = get_target_date()
    weekend     = is_weekend(target_date)

    # Weekend: 1-hour session 17:00–18:00; Weekday: 40-min session 18:40–19:20
    if weekend:
        time_from   = '17:00'
        time_to     = '18:00'
        timetable_slugs = TIMETABLE_SLUGS_60MIN
    else:
        time_from   = '18:40'
        time_to     = '19:20'
        timetable_slugs = TIMETABLE_SLUGS_40MIN

    locations = [
        {'slug': LOCATION_1, 'name': LOC1_NAME, 'court_pref': None if weekend else 'Court 1'},
        {'slug': LOCATION_2, 'name': LOC2_NAME, 'court_pref': None},
    ]

    day_label = target_date.strftime('%A, %d %B %Y')
    print(f'\nTarget: {day_label} ({"Weekend" if weekend else "Weekday"})')
    print(f'Time window: {time_from} – {time_to}')

    session = make_session()
    login(session)

    # Pre-position: load today's timetable before the booking window opens
    for loc in locations:
        try:
            get_timetable(session, loc['slug'], datetime.now(), timetable_slugs)
            break
        except Exception:
            pass

    wait_until_booking_opens()

    for loc in locations:
        print(f'\nPre-positioning at {loc["name"]}…')
        for attempt in range(1, RETRY_ATTEMPTS + 1):
            try:
                print(f'Attempt {attempt}/{RETRY_ATTEMPTS} — navigating to target date…')
                html, _ = get_timetable(session, loc['slug'], target_date, timetable_slugs)
                slots = find_slots(html, time_from, time_to, loc['court_pref'])
                print(f'Found {len(slots)} available slot(s)')
                if not slots:
                    raise RuntimeError(f'No slots available between {time_from}–{time_to}')

                slot_href = slots[0]
                print(f'Booking slot: {slot_href}')
                booked_time = book_slot(session, slot_href)
                print(f'Slot selected at {loc["name"]}: {booked_time}')

                checkout(session)
                ref = confirm_booking(session)
                print(f'Booking confirmed at {loc["name"]}! Reference: {ref}')
                return

            except Exception as e:
                print(f'Attempt {attempt} failed at {loc["name"]}: {e}')
                if attempt < RETRY_ATTEMPTS:
                    print(f'Waiting {RETRY_DELAY_S}s before retry…')
                    time.sleep(RETRY_DELAY_S)

    raise RuntimeError(
        f'No badminton slots booked at any location for {day_label} ({time_from}–{time_to})'
    )


if __name__ == '__main__':
    try:
        run()
    except Exception as e:
        print(f'ERROR: {e}', file=sys.stderr)
        sys.exit(1)
