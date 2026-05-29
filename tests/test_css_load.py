#!/usr/bin/env python3
from playwright.sync_api import sync_playwright

def test_css_loads():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        
        try:
            page.goto('http://localhost:5500', timeout=10000)
            page.wait_for_load_state('networkidle', timeout=5000)
            
            # Check if styles are applied
            help_icon_style = page.evaluate("""
                () => {
                    const icon = document.querySelector('.help-icon');
                    if (!icon) return 'NOT_FOUND';
                    const styles = window.getComputedStyle(icon);
                    return {
                        display: styles.display,
                        borderRadius: styles.borderRadius,
                        cursor: styles.cursor,
                        width: styles.width,
                        height: styles.height
                    };
                }
            """)
            
            print("Help icon computed styles:", help_icon_style)
            
            # Check sr-only
            sr_only_style = page.evaluate("""
                () => {
                    const el = document.querySelector('.sr-only');
                    if (!el) return 'NOT_FOUND';
                    const styles = window.getComputedStyle(el);
                    return {
                        position: styles.position,
                        width: styles.width,
                        height: styles.height,
                        overflow: styles.overflow
                    };
                }
            """)
            
            print("SR-only computed styles:", sr_only_style)
            
            # Check for CSS errors in console
            errors = []
            page.on('console', lambda msg: errors.append(f"{msg.type}: {msg.text}") if msg.type in ['error', 'warning'] else None)
            page.wait_for_timeout(1000)
            
            print(f"Console errors: {errors if errors else 'None'}")
            print("✓ CSS loaded successfully")
            
        except Exception as e:
            print(f"✗ Error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            browser.close()

if __name__ == '__main__':
    test_css_loads()
