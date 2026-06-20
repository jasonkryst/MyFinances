#!/usr/bin/env python3
from playwright.async_api import async_playwright
import asyncio

async def test_menu_initial():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        # Test at 400px (narrow mobile)
        page = await browser.new_page(viewport={"width": 400, "height": 800})
        
        try:
            await page.goto('http://localhost:5500', timeout=10000)
            await page.wait_for_load_state('networkidle', timeout=5000)
            
            # Check if menu is initially visible
            menu_visible = await page.evaluate("""() => {
                const menu = document.querySelector('#navMenu');
                const styles = window.getComputedStyle(menu);
                return styles.display;
            }""")
            
            print(f"Initial menu display: {menu_visible}")
            print("Taking screenshot of initial state (before clicking toggle)...")
            await page.screenshot(path='debug_menu_initial.png')
            print("Screenshot saved to debug_menu_initial.png")
            
        except Exception as e:
            print(f"Error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            await browser.close()

if __name__ == '__main__':
    asyncio.run(test_menu_initial())
