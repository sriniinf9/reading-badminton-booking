import os
import re
import sys
import time
from datetime import datetime, timedelta

from playwright.sync_api import sync_playwright, Page, BrowserContext, expect

# ── Config from environment ───────────────────────────────────────────────────
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


def get_target_date() -> datetime:
    return datetime.now() + timedelta(days=7)


def is_weekend(date: datetime) -> bool:
    return date.weekday() >= 5  # 5=Sat, 6=Sun


def wait_until_booking_opens(page: Page) -> None:
    now = datetime.now()
    open_time = now.replace(hour=BOOKING_OPEN_HOUR, minute=BOOKING_OPEN_MIN, second=2, microsecond=0)
    wait_secs = (open_time - now).total_seconds()
    if 0 < wait_secs <= 10 * 60:
        print(f'Pre-positioned. Waiting {int(wait_secs)}s for booking window to open '
              f'at {BOOKING_OPEN_HOUR:02d}:{BOOKING_OPEN_MIN:02d}...')
        page.wait_for_timeout(int(wait_secs * 1000))
        print('Booking window open — attempting now.')


def set_consent_cookie(context: BrowserContext) -> None:
    hostname = re.sub(r'^https?://', '', BASE_URL).split('/')[0]
    context.add_cookies([{
        'name': 'OptanonAlertBoxClosed',
        'value': datetime.now().isoformat(),
        'domain': hostname,
        'path': '/',
        'expires': int(time.time()) + 365 * 24 * 3600,
    }])


def navigate(page: Page, path: str = '') -> None:
    page.goto(f'{BASE_URL}{path}')


def dismiss_cookie_banner(page: Page) -> None:
    try:
        page.evaluate("""() => {
            const btn =
                document.getElementById('onetrust-accept-btn-handler') ??
                document.querySelector('.onetrust-accept-btn-handler') ??
                Array.from(document.querySelectorAll('button')).find(
                    b => /accept all/i.test(b.textContent ?? '')
                );
            if (btn) btn.click();
        }""")
        page.locator('#onetrust-consent-sdk').wait_for(state='hidden', timeout=5000)
    except Exception:
        pass


def login(page: Page) -> None:
    navigate(page, '/')
    dismiss_cookie_banner(page)

    login_btn = page.get_by_role('button', name=re.compile(r'log in|sign in', re.I)).first
    login_btn.wait_for(state='visible', timeout=15000)
    login_btn.click(force=True)

    email_field = page.locator(
        'input[type="email"], input[name="email"], input[id*="email"], '
        'input[id*="username"], input[id*="member"]'
    ).first
    email_field.wait_for(state='visible', timeout=15000)
    email_field.fill(EMAIL)

    password_field = page.locator('input[type="password"]').first
    password_field.fill(PASSWORD)
    password_field.press('Enter')
    page.wait_for_load_state('load')

    error_loc = page.locator(
        '[data-testid="login-error"], .error-message, .alert-danger, [role="alert"]'
    ).first
    if error_loc.is_visible():
        msg = error_loc.text_content() or ''
        raise RuntimeError(f'Login failed: {msg.strip()}')

    # Modal closes when email field disappears
    email_field.wait_for(state='hidden', timeout=20000)
    print('Logged in successfully')


def navigate_to_timetable(page: Page, location_slug: str, target_date: datetime) -> None:
    date_str = target_date.strftime('%Y-%m-%d')
    candidates = [
        f'/location/{location_slug}/badminton-40min/{date_str}/by-time',
        f'/location/{location_slug}/badminton-60min/{date_str}/by-time',
        f'/location/{location_slug}/badminton-sessions/{date_str}/by-time',
        f'/location/{location_slug}/sports-hall-activities/badminton-40min/{date_str}/by-time',
    ]
    for url in candidates:
        print(f'Trying timetable URL: {url}')
        navigate(page, url)
        page.wait_for_load_state('load')
        try:
            page.wait_for_load_state('networkidle', timeout=30000)
        except Exception:
            pass
        try:
            page.wait_for_selector('a, button', timeout=15000)
        except Exception:
            pass
        if date_str not in page.url:
            print(f'Redirected away from {date_str} — got: {page.url}')
            continue
        body = page.locator('body').inner_text()
        if re.search(r"gone offside|doesn't exist|not found|404", body, re.I):
            print(f'404 error page at {url} — skipping')
            continue
        print(f'Timetable loaded: {page.url}')
        return
    raise RuntimeError(
        f'Timetable navigation failed for all URL patterns — last URL: {page.url}'
    )


def book_slot(page: Page, time_from: str, time_to: str, court_pref: str | None = None) -> str:
    page.wait_for_load_state('load')
    try:
        page.wait_for_load_state('networkidle', timeout=20000)
    except Exception:
        pass

    from_h, from_m = map(int, time_from.split(':'))
    to_h, to_m     = map(int, time_to.split(':'))
    from_mins = from_h * 60 + from_m
    to_mins   = to_h   * 60 + to_m

    slot_links = page.locator('a[href*="/slot/"]')
    slot_count = slot_links.count()
    print(f'Found {slot_count} available slot links')

    for i in range(slot_count):
        link = slot_links.nth(i)
        href = link.get_attribute('href') or ''
        m = re.search(r'/slot/(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/', href)
        if not m:
            continue
        start_h, start_m = map(int, m.group(1).split(':'))
        slot_mins = start_h * 60 + start_m
        if slot_mins < from_mins or slot_mins > to_mins:
            continue
        if court_pref:
            card_text = link.text_content() or ''
            if court_pref.lower() not in card_text.lower():
                continue
        label = m.group(1) + (f' @ {court_pref}' if court_pref else '')
        print(f'Booking slot: {label} ({href})')
        link.click()
        page.wait_for_load_state('load')
        return label

    # Retry without court preference if nothing matched
    if court_pref:
        print(f'No "{court_pref}" slot found, retrying without court preference...')
        return book_slot(page, time_from, time_to, None)

    # Diagnostics on failure
    print(f'[book_slot] FAILED — URL: {page.url}')
    print(f'[book_slot] Page title: "{page.title()}"')
    print(f'[book_slot] Body (first 500): {page.locator("body").inner_text()[:500]}')
    raise RuntimeError(f'No slots available between {time_from}–{time_to}')


def add_to_basket_and_checkout(page: Page) -> None:
    add_btn = page.get_by_role(
        'button', name=re.compile(r'add to basket|add to cart|book', re.I)
    ).first
    add_btn.wait_for(state='visible', timeout=10000)
    add_btn.click()
    page.wait_for_load_state('load')
    print('Added to basket')

    checkout_btn = page.get_by_role(
        'button', name=re.compile(r'checkout|proceed to checkout', re.I)
    ).or_(
        page.get_by_role('link', name=re.compile(r'checkout', re.I))
    ).first
    checkout_btn.wait_for(state='visible', timeout=10000)
    checkout_btn.click()
    page.wait_for_load_state('load')
    try:
        page.wait_for_load_state('networkidle', timeout=15000)
    except Exception:
        pass
    print('Proceeding to checkout')


def confirm_booking(page: Page) -> str:
    confirm_btn = page.get_by_role(
        'button', name=re.compile(r'confirm booking|confirm|pay now|complete', re.I)
    ).first
    confirm_btn.wait_for(state='visible', timeout=15000)

    # Tick any required unchecked checkboxes (T&Cs etc.) that gate the button
    checkboxes = page.locator('input[type="checkbox"]')
    for i in range(checkboxes.count()):
        cb = checkboxes.nth(i)
        if cb.is_visible() and not cb.is_checked():
            cb.check()
            print(f'Checked checkbox {i}')

    expect(confirm_btn).to_be_enabled(timeout=10000)
    confirm_btn.click()

    page.get_by_text(
        re.compile(r'booking confirmed|booking successful|thank you', re.I)
    ).first.wait_for(timeout=20000)

    ref_loc = page.locator(
        '[data-testid="booking-ref"], .booking-reference, .confirmation-number'
    ).first
    ref = ref_loc.text_content() if ref_loc.is_visible() else 'N/A'
    print(f'Booking confirmed! Reference: {ref}')
    return (ref or 'N/A').strip()


def run() -> None:
    target_date = get_target_date()
    weekend     = is_weekend(target_date)

    time_from = os.environ.get('TIME_FROM', '17:00' if weekend else '18:40')
    time_to   = os.environ.get('TIME_TO',   '18:00' if weekend else '19:40')

    locations = [
        {'slug': LOCATION_1, 'name': LOC1_NAME, 'court_pref': None if weekend else 'Court 1'},
        {'slug': LOCATION_2, 'name': LOC2_NAME, 'court_pref': None},
    ]

    day_label = target_date.strftime('%A, %d %B %Y')
    print(f'\nTarget: {day_label} ({"Weekend" if weekend else "Weekday"})')
    print(f'Time window: {time_from} – {time_to}')

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        set_consent_cookie(context)
        page = context.new_page()

        try:
            login(page)

            for loc in locations:
                print(f'\nPre-positioning at {loc["name"]}...')
                try:
                    navigate_to_timetable(page, loc['slug'], datetime.now())
                    wait_until_booking_opens(page)

                    booked = False
                    for attempt in range(1, RETRY_ATTEMPTS + 1):
                        try:
                            print(f'Attempt {attempt}/{RETRY_ATTEMPTS} — navigating to target date...')
                            navigate_to_timetable(page, loc['slug'], target_date)
                            slot = book_slot(page, time_from, time_to, loc['court_pref'])
                            print(f'Slot selected at {loc["name"]}: {slot}')
                            add_to_basket_and_checkout(page)
                            ref = confirm_booking(page)
                            print(f'Booking confirmed at {loc["name"]}! Reference: {ref}')
                            booked = True
                            break
                        except Exception as e:
                            print(f'Attempt {attempt} failed at {loc["name"]}: {e}')
                            if attempt < RETRY_ATTEMPTS:
                                print(f'Waiting {RETRY_DELAY_S}s before retry...')
                                time.sleep(RETRY_DELAY_S)

                    if booked:
                        return

                except Exception as e:
                    print(f'Navigation failed for {loc["name"]}: {e}')

            raise RuntimeError(
                f'No badminton slots available at any location for {day_label} ({time_from}–{time_to})'
            )

        finally:
            context.close()
            browser.close()


if __name__ == '__main__':
    try:
        run()
    except Exception as e:
        print(f'ERROR: {e}', file=sys.stderr)
        sys.exit(1)
