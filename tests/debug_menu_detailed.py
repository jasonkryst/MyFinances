#!/usr/bin/env python3
from playwright.async_api import async_playwright
import asyncio

async def test_menu_detailed():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 400, "height": 800})
        
        try:
            await page.goto('http://localhost:5500', timeout=10000)
            await page.wait_for_load_state('networkidle', timeout=5000)
            
            print("=== INITIAL STATE (400px width) ===")
            
            # Check initial menu state
            initial_display = await page.evaluate("""() => {
                const menu = document.querySelector('#navMenu');
                const styles = window.getComputedStyle(menu);
                return {
                    display: styles.display,
                    position: styles.position,
                    visibility: styles.visibility,
                    opacity: styles.opacity,
                    height: styles.height,
                    zIndex: styles.zIndex,
                    overflow: styles.overflow
                };
            }""")
            print(f"Nav menu initial computed styles:")
            for key, val in initial_display.items():
                print(f"  {key}: {val}")
                
            # Check top-nav styles
            top_nav_styles = await page.evaluate("""() => {
                const nav = document.querySelector('#topNav');
                const styles = window.getComputedStyle(nav);
                return {
                    display: styles.display,
                    position: styles.position,
                    zIndex: styles.zIndex,
                    height: styles.height,
                    overflow: styles.overflow
                };
            }""")
            print(f"\nTop nav initial computed styles:")
            for key, val in top_nav_styles.items():
                print(f"  {key}: {val}")
            
            # Click the toggle
            print("\n=== CLICKING TOGGLE ===")
            await page.click('#navToggle')
            await page.wait_for_timeout(300)
            
            # Check menu state after click
            after_click = await page.evaluate("""() => {
                const menu = document.querySelector('#navMenu');
                const styles = window.getComputedStyle(menu);
                const buttons = menu.querySelectorAll('.page-button');
                return {
                    display: styles.display,
                    visibility: styles.visibility,
                    opacity: styles.opacity,
                    height: styles.height,
                    overflow: styles.overflow,
                    buttonCount: buttons.length,
                    buttonsVisible: Array.from(buttons).map(btn => ({
                        text: btn.textContent,
                        display: window.getComputedStyle(btn).display,
                        opacity: window.getComputedStyle(btn).opacity,
                        height: window.getComputedStyle(btn).height
                    }))
                };
            }""")
            print(f"Nav menu after click:")
            print(f"  display: {after_click['display']}")
            print(f"  visibility: {after_click['visibility']}")
            print(f"  opacity: {after_click['opacity']}")
            print(f"  height: {after_click['height']}")
            print(f"  overflow: {after_click['overflow']}")
            print(f"  Button count: {after_click['buttonCount']}")
            print(f"  Buttons visible: {after_click['buttonCount'] > 0}")
            
            if after_click['buttonsVisible']:
                print("\n  Button details:")
                for btn in after_click['buttonsVisible']:
                    print(f"    {btn['text']}: display={btn['display']}, opacity={btn['opacity']}, height={btn['height']}")
            
            # Take a screenshot
            print("\n=== TAKING SCREENSHOT ===")
            await page.screenshot(path='debug_menu_screenshot.png')
            print("Screenshot saved to debug_menu_screenshot.png")
            
        except Exception as e:
            print(f"Error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            await browser.close()

if __name__ == '__main__':
    asyncio.run(test_menu_detailed())
