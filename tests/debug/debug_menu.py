#!/usr/bin/env python3
from playwright.async_api import async_playwright
import asyncio

async def test_menu_narrow():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 500, "height": 800})
        
        try:
            await page.goto('http://localhost:5500', timeout=10000)
            await page.wait_for_load_state('networkidle', timeout=5000)
            
            # Get the nav elements
            nav_toggle = await page.query_selector('#navToggle')
            nav_menu = await page.query_selector('#navMenu')
            top_nav = await page.query_selector('#topNav')
            
            if not nav_toggle:
                print("❌ Nav toggle button not found")
            else:
                toggle_display = await page.evaluate('document.querySelector("#navToggle").style.display')
                toggle_computed = await page.evaluate('window.getComputedStyle(document.querySelector("#navToggle")).display')
                print(f"Nav toggle display: {toggle_display} (computed: {toggle_computed})")
                
            if not nav_menu:
                print("❌ Nav menu not found")
            else:
                menu_display = await page.evaluate('document.querySelector("#navMenu").style.display')
                menu_computed = await page.evaluate('window.getComputedStyle(document.querySelector("#navMenu")).display')
                print(f"Nav menu display: {menu_display} (computed: {menu_computed})")
                
            if not top_nav:
                print("❌ Top nav not found")
            else:
                has_menu_open = await page.evaluate('document.querySelector("#topNav").classList.contains("menu-open")')
                print(f"Top nav has menu-open class: {has_menu_open}")
                
            # Try clicking the toggle
            print("\nAttempting to click nav toggle...")
            await page.click('#navToggle')
            await page.wait_for_timeout(300)
            
            menu_display_after = await page.evaluate('window.getComputedStyle(document.querySelector("#navMenu")).display')
            has_menu_open_after = await page.evaluate('document.querySelector("#topNav").classList.contains("menu-open")')
            print(f"After click - Nav menu display: {menu_display_after}")
            print(f"After click - Top nav has menu-open class: {has_menu_open_after}")
            
            # Get computed styles
            nav_menu_styles = await page.evaluate("""
                const menu = document.querySelector('#navMenu');
                const styles = window.getComputedStyle(menu);
                return {
                    display: styles.display,
                    flexDirection: styles.flexDirection,
                    width: styles.width,
                    visibility: styles.visibility,
                    position: styles.position
                };
            """)
            print(f"\nNav menu computed styles: {nav_menu_styles}")
            
            # Check for console errors
            console_errors = []
            page.on('console', lambda msg: console_errors.append(f"{msg.type}: {msg.text}"))
            
            print(f"\nConsole errors: {console_errors if console_errors else 'None'}")
            
        except Exception as e:
            print(f"Error: {e}")
        finally:
            await browser.close()

if __name__ == '__main__':
    asyncio.run(test_menu_narrow())
