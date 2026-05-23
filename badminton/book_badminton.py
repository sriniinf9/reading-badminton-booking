import os
import sys
import time
from datetime import datetime, timedelta

import requests


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

AUTH_BASE         = 'https://better-admin.org.uk'
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
    'Accept': 'application/json, text/plain, */*',
    'Origin': BASE_URL,
    'Referer': f'{BASE_URL}/',
}

ACTIVITY_SLUGS_40MIN = ['badminton-40min']
ACTIVITY_SLUGS_60MIN = ['badminton-60min', 'badminton-40min']


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


def login(session: requests.Session) -> int:
    """Login and return membership_user_id."""
    r = session.post(
        f'{AUTH_BASE}/api/auth/customer/login',
        json={'username': EMAIL, 'password': PASSWORD},
        timeout=20,
    )
    if r.status_code != 200:
        raise RuntimeError(f'Login failed — HTTP {r.status_code}: {r.text[:200]}')
    data = r.json()
    token = data.get('token')
    if not token:
        raise RuntimeError('Login failed — no token in response')
    session.headers['Authorization'] = f'Bearer {token}'

    user_r = session.get(f'{AUTH_BASE}/api/auth/user', timeout=15)
    user_r.raise_for_status()
    user = user_r.json()['data']
    membership_user_id = (user.get('membership_user') or {}).get('id')
    print(f'Logged in as {user["first_name"]} {user["last_name"]} '
          f'(membership: {membership_user_id})')
    return membership_user_id


def get_times(session: requests.Session, venue_slug: str, activity_slug: str,
              date: datetime) -> list:
    """Return all time-slot entries from the better-admin times API."""
    date_str = date.strftime('%Y-%m-%d')
    url = (f'{AUTH_BASE}/api/activities/venue/{venue_slug}'
           f'/activity/{activity_slug}/v2/times?date={date_str}')
    print(f'Fetching times: venue={venue_slug} activity={activity_slug} date={date_str}')
    r = session.get(url, timeout=20)
    if r.status_code != 200:
        raise RuntimeError(f'Times API {r.status_code} for {activity_slug}')
    return r.json().get('data', [])


def find_available_slots(slots: list, time_from: str, time_to: str) -> list:
    """Filter to slots with BOOK status whose start falls in [time_from, time_to]."""
    fh, fm = map(int, time_from.split(':'))
    th, tm = map(int, time_to.split(':'))
    from_mins = fh * 60 + fm
    to_mins   = th * 60 + tm

    return [
        s for s in slots
        if s.get('action_to_show', {}).get('status') == 'BOOK'
        and from_mins <= (
            lambda t: int(t.split(':')[0]) * 60 + int(t.split(':')[1])
        )(s['starts_at']['format_24_hour']) <= to_mins
    ]


def get_slot_detail(session: requests.Session, venue_slug: str, activity_slug: str,
                    slot: dict) -> dict:
    """Fetch the specific slot occurrence including court, occurrence ID, pricing."""
    date_str     = slot['date']
    start_time   = slot['starts_at']['format_24_hour']
    end_time     = slot['ends_at']['format_24_hour']
    composite_key = slot['composite_key']

    url = (f'{AUTH_BASE}/api/activities/venue/{venue_slug}'
           f'/activity/{activity_slug}/v2/slots'
           f'?date={date_str}&start_time={start_time}'
           f'&end_time={end_time}&composite_key={composite_key}')
    r = session.get(url, timeout=20)
    if r.status_code != 200 or not r.json().get('data'):
        raise RuntimeError(f'Slot detail not found for {start_time}')
    detail = r.json()['data'][0]
    if detail.get('action_to_show', {}).get('status') != 'BOOK':
        raise RuntimeError(
            f'Slot {start_time} not bookable: {detail["action_to_show"]["status"]}'
        )
    return detail


def add_to_cart(session: requests.Session, slot_detail: dict,
                membership_user_id: int) -> dict:
    """Add a slot occurrence to the cart. Returns cart data."""
    payload = {
        'items': [{
            'id':                       slot_detail['id'],
            'type':                     slot_detail['cart_type'],
            'pricing_option_id':        slot_detail['pricing_option_id'],
            'apply_benefit':            True,
            'activity_restriction_ids': [],
        }],
        'membership_user_id': membership_user_id,
        'selected_user_id':   None,
    }
    r = session.post(f'{AUTH_BASE}/api/activities/cart/add', json=payload, timeout=20)
    if r.status_code != 200:
        raise RuntimeError(f'Cart add failed: {r.status_code} {r.text[:200]}')
    cart = r.json()['data']
    print(f'Added to basket: {cart["formattedTotal"]}')
    return cart


def checkout_and_confirm(session: requests.Session, cart: dict) -> str:
    """Checkout using saved card and return the booking reference."""
    cart_id = cart['id']

    # 1. Prepare — get session_key and saved card token
    r = session.get(f'{AUTH_BASE}/api/checkout/prepare', timeout=20)
    if r.status_code != 200:
        raise RuntimeError(f'Checkout prepare: {r.status_code}')
    prepare    = r.json()
    session_key = prepare['session_key']
    saved_card  = prepare.get('saved_card')
    if not saved_card:
        raise RuntimeError('No saved card on account — add a card at bookings.better.org.uk first')

    # 2. Fetch terms that must be accepted
    r = session.get(f'{AUTH_BASE}/api/terms?cart_id={cart_id}', timeout=20)
    terms = [t['id'] for t in r.json().get('data', [])]

    # 3. Authorise payment with the saved card
    auth_payload = {
        'payments':       [],
        'session_key':    session_key,
        'source':         'activity-booking',
        'terms':          terms,
        'save_card':      False,
        'item_hash':      None,
        'saved_card_id':  saved_card['external_identifier'],
        'card_holder_name': saved_card.get('card_holder_name', ''),
    }
    r = session.post(f'{AUTH_BASE}/api/checkout/authorise',
                     json=auth_payload, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f'Checkout authorise: {r.status_code} {r.text[:300]}')
    auth = r.json()
    tx_uuid = auth.get('transactionUuid') or auth.get('transaction_uuid')
    status  = auth.get('transactionStatus') or auth.get('transaction_status', '')
    if status in ('failed', 'aborted'):
        raise RuntimeError(f'Payment declined: {auth}')
    print(f'Payment authorised (status={status})')

    # 4. Complete checkout
    complete_payload = {
        'completed_waivers': [],
        'payments':          [{'transaction_id': tx_uuid}] if tx_uuid else [],
        'source':            'activity-booking',
        'selected_user_id':  None,
        'terms':             terms,
        'item_hash':         tx_uuid,
    }
    r = session.post(f'{AUTH_BASE}/api/checkout/complete',
                     json=complete_payload, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f'Checkout complete: {r.status_code} {r.text[:300]}')

    data = r.json()
    inner = data.get('data', data)
    ref = (inner.get('reference')
           or inner.get('complete_order_id')
           or inner.get('completeOrderId')
           or 'N/A')
    print(f'Booking confirmed! Reference: {ref}')
    return str(ref)


def _try_book_location(session: requests.Session, loc: dict,
                       activity_slugs: list[str], target_date: datetime,
                       time_from: str, time_to: str,
                       membership_user_id: int) -> str | None:
    """Try every activity slug and every bookable slot. Returns reference or None."""
    for activity_slug in activity_slugs:
        try:
            slots = get_times(session, loc['slug'], activity_slug, target_date)
        except Exception as e:
            print(f'  {activity_slug}: {e}')
            continue

        available = find_available_slots(slots, time_from, time_to)
        if not available:
            print(f'  No available slots for {activity_slug} in {time_from}–{time_to}')
            continue

        print(f'  Found {len(available)} slot(s) for {activity_slug}')

        court_pref = loc.get('court_pref')

        # Two passes: preferred court first, then any court
        for pref in ([court_pref] if court_pref else [None]) + ([None] if court_pref else []):
            for slot_summary in available:
                start = slot_summary['starts_at']['format_24_hour']
                try:
                    detail = get_slot_detail(session, loc['slug'], activity_slug, slot_summary)
                    court_name = detail.get('location', {}).get('name', '')

                    if pref and pref.lower() not in court_name.lower():
                        print(f'  Skipping {start} (court: {court_name!r})')
                        continue

                    print(f'  Booking {start} @ {court_name}')
                    cart = add_to_cart(session, detail, membership_user_id)
                    return checkout_and_confirm(session, cart)

                except Exception as e:
                    print(f'  Slot {start} error: {e}')
                    continue

    return None


def run() -> None:
    target_date = get_target_date()
    weekend     = is_weekend(target_date)

    if weekend:
        time_from, time_to = '17:00', '18:00'
        activity_slugs = ACTIVITY_SLUGS_60MIN
    else:
        time_from, time_to = '18:40', '19:20'
        activity_slugs = ACTIVITY_SLUGS_40MIN

    locations = [
        {'slug': LOCATION_1, 'name': LOC1_NAME,
         'court_pref': None if weekend else 'Court 1'},
        {'slug': LOCATION_2, 'name': LOC2_NAME, 'court_pref': None},
    ]

    day_label = target_date.strftime('%A, %d %B %Y')
    print(f'\nTarget: {day_label} ({"Weekend" if weekend else "Weekday"})')
    print(f'Time window: {time_from} – {time_to}')

    session = make_session()
    membership_user_id = login(session)

    wait_until_booking_opens()

    for loc in locations:
        print(f'\nPre-positioning at {loc["name"]}…')
        for attempt in range(1, RETRY_ATTEMPTS + 1):
            try:
                print(f'Attempt {attempt}/{RETRY_ATTEMPTS} — navigating to target date…')
                ref = _try_book_location(
                    session, loc, activity_slugs,
                    target_date, time_from, time_to,
                    membership_user_id,
                )
                if ref:
                    print(f'Booking confirmed at {loc["name"]}! Reference: {ref}')
                    return
                raise RuntimeError(f'No slots available between {time_from}–{time_to}')
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
