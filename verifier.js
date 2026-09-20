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
const targetServer = process.env.TARGET_SERVER || '亞洲服'; // 預設給個防呆值
const targetUid = process.env.TARGET_UID;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function startVerifier() {
    console.log(`[啟動審查] 接收到訂單 ${orderNo}，準備檢查 UID: ${targetUid}`);
    
    // 💡 雲端 Linux 伺服器必須加上 --no-sandbox 參數才能順利啟動隱形瀏覽器
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }); 
    const page = await browser.newPage();

    try {
        await page.goto('https://pay.neteasegames.com/identityv/topup', { waitUntil: 'networkidle2' });

        // 1. 選擇伺服器
        await page.waitForSelector('.bui-select-selector', { visible: true });
        await page.click('.bui-select-selector'); 
        await sleep(500); // 等待下拉選單動畫展開
        
        // 模擬輸入伺服器名稱並按下 Enter 選擇
        await page.type('.bui-select-selection-search-input', targetServer, { delay: 100 });
        await sleep(500); 
        await page.keyboard.press('Enter');

        // 2. 填寫 UID
        await page.waitForSelector('input[placeholder="請輸入遊戲ID"]', { visible: true });
        await page.type('input[placeholder="請輸入遊戲ID"]', targetUid, { delay: 50 });

        // 3. 勾選隱私協議
        await page.waitForSelector('.privacy-wrap-pc label', { visible: true });
        await page.click('.privacy-wrap-pc label');
        await sleep(500);

        // 4. 點擊登入
        await page.waitForSelector('.userid-login-btn', { visible: true });
        await page.click('.userid-login-btn');

        // 給予網頁充足的時間載入驗證結果
        await sleep(3000);

        await page.waitForSelector('img[alt="690エコー"]');
        await page.click('img[alt="690エコー"]');
        await sleep(1000);
        
        await page.waitForSelector('.topup-action .topup-btn');
        await page.click('.topup-action .topup-btn');

        console.log(`[${targetUid}] 正在探測年齡驗證彈窗...`);
        
        const result = await Promise.race([
            page.waitForSelector('#bui-confirm .bui-modal-content', { timeout: 10000 }).then(() => 'BLOCKED'),
            page.waitForSelector('.pass-code-container input', { timeout: 10000 }).then(() => 'PASS')
        ]);

        await browser.close();

        // 2. 依照結果更新 Supabase 並發送 Discord
        if (result === 'BLOCKED') {
            console.log(`🚨 訂單 ${orderNo} 未實名！`);
            await supabase.from('orders').update({ realname_status: 'UNVERIFIED' }).eq('id', orderId);

            await fetch(DISCORD_WEBHOOK, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: `⚠️ **緊急通知：帳號未實名阻擋！**\n訂單編號：${orderNo}\n玩家 UID：${targetUid}\n請立刻聯絡客戶進行實名認證！`
                })
            });
        } else if (result === 'PASS') {
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