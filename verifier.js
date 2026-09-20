const WebSocket = require('ws');
global.WebSocket = WebSocket;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

// 1. 從 GitHub Actions 環境變數讀取安全資料
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; 
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

const orderId = process.env.ORDER_ID;
const orderNo = process.env.ORDER_NO;
const targetServer = process.env.TARGET_SERVER || '亞洲服';
const targetUid = process.env.TARGET_UID;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function startVerifier() {
    console.log(`[啟動審查] 接收到訂單 ${orderNo}，準備檢查 UID: ${targetUid}`);
    
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }); 
    const page = await browser.newPage();

    try {
        await page.goto('https://pay.neteasegames.com/identityv/topup', { waitUntil: 'networkidle2' });
        await sleep(2000);

        // 1. 填寫伺服器與 UID
        try {
            await page.waitForSelector('.bui-select-selector', { timeout: 10000 });
            await page.click('.bui-select-selector');
            await sleep(500);
            await page.type('.bui-select-selection-search-input', targetServer || '亞洲服', { delay: 100 });
            await sleep(500);
            await page.keyboard.press('Enter');
        } catch (e) {}

        await page.waitForSelector('input.bui-input.gc-input-pc', { visible: true, timeout: 15000 });
        await page.type('input.bui-input.gc-input-pc', targetUid, { delay: 50 });

        await page.waitForSelector('.privacy-wrap-pc label, .bui-checkbox-content', { visible: true });
        await page.click('.privacy-wrap-pc label, .bui-checkbox-content');
        await sleep(500);

        // 2. 透過前端強效腳本強制點擊登入按鈕
        console.log("正在強制觸發登入按鈕...");
        const loginSuccess = await page.evaluate(() => {
            const btn = document.querySelector('.userid-login-btn');
            if (btn) {
                // 模擬完整滑鼠點擊事件，破解前端框架阻擋
                btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                btn.click();
                return true;
            }
            return false;
        });

        if (loginSuccess) {
            console.log("已成功送出登入，等待伺服器回應角色資料...");
            await sleep(5000); // 給予充足時間讓伺服器回應 UID 角色
        } else {
            console.error("找不到登入按鈕元素！");
        }

        await page.screenshot({ path: 'step1_after_login.png', fullPage: true });

        // 3. 點擊商品 (690 商品)
        const targetProductImg = await page.$('img[alt="690エコー"]');
        if (targetProductImg) {
            await targetProductImg.click();
            await sleep(2000);
        }

        // 4. 點擊儲存/下一步按鈕
        const topupBtn = await page.$('.topup-action .topup-btn');
        if (topupBtn) {
            await topupBtn.click();
            await sleep(3000);
        }

        await page.screenshot({ path: 'step2_after_topup.png', fullPage: true });

        // 5. 偵測真正的未實名阻擋
        console.log(`[${targetUid}] 正在精準偵測實名驗證狀態...`);
        
        let result = 'PASS';
        try {
            const blockedElement = await page.waitForFunction(
                () => {
                    const bodyText = document.body.innerText;
                    return bodyText.includes('未實名') || bodyText.includes('未成年') || bodyText.includes('认证') || document.querySelector('#bui-confirm');
                },
                { timeout: 5000 }
            );
            if (blockedElement) {
                result = 'BLOCKED';
            }
        } catch (e) {
            result = 'PASS';
        }

        await page.screenshot({ path: `final_${result}.png`, fullPage: true });
        await browser.close();

        // ==========================================
        // 6. 依照結果更新 Supabase 並發送 Discord
        // ==========================================
        if (result === 'BLOCKED') {
            console.log(`🚨 訂單 ${orderNo} 未實名/被阻擋！`);
            await supabase.from('orders').update({ realname_status: 'UNVERIFIED' }).eq('id', orderId);

            if (DISCORD_WEBHOOK) {
                await fetch(DISCORD_WEBHOOK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: `⚠️ **緊急通知：帳號未實名阻擋！**\n訂單編號：${orderNo}\n玩家 UID：${targetUid}\n請立刻聯絡客戶進行實名認證！`
                    })
                });
            }
        } else {
            console.log(`✅ 訂單 ${orderNo} 實名驗證通過！`);
            await supabase.from('orders').update({ realname_status: 'VERIFIED' }).eq('id', orderId);
        }

    } catch (error) {
        console.error(`[${targetUid}] 檢查過程發生錯誤：`, error);
        await browser.close();
    }
}

// GitHub Actions 啟動入口
startVerifier();