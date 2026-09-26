$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$chromeCandidates = @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
)
$browser = $chromeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $browser) { throw 'Chrome or Edge was not found.' }

$tempRoot = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ('kkk35g1-tests-' + [Guid]::NewGuid().ToString('N'))))
New-Item -ItemType Directory -Path $tempRoot | Out-Null

function Invoke-HeadlessDump([string]$pagePath, [string]$name, [int]$virtualTime = 0) {
    $stdout = Join-Path $tempRoot ($name + '.html')
    $stderr = Join-Path $tempRoot ($name + '.err.txt')
    $profile = Join-Path $tempRoot ($name + '-profile')
    $url = ([Uri](Resolve-Path $pagePath).Path).AbsoluteUri
    $arguments = @(
        '--headless=new', '--disable-gpu', '--no-first-run',
        '--allow-file-access-from-files', ('--user-data-dir=' + $profile)
    )
    if ($virtualTime -gt 0) { $arguments += '--virtual-time-budget=' + $virtualTime }
    $arguments += @('--dump-dom', $url)
    $process = Start-Process -FilePath $browser -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    if ($process.ExitCode -ne 0) { throw "$name browser exit code: $($process.ExitCode)" }
    return [pscustomobject]@{
        Html = Get-Content -Raw -LiteralPath $stdout
        Errors = Get-Content -Raw -LiteralPath $stderr
    }
}

function Invoke-CdpIntegrationTest {
    $port = Get-Random -Minimum 9300 -Maximum 9900
    $profile = Join-Path $tempRoot 'integration-profile'
    $pageUrl = ([Uri](Resolve-Path (Join-Path $projectRoot 'index.html')).Path).AbsoluteUri
    $arguments = @(
        '--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
        '--remote-allow-origins=*', ('--remote-debugging-port=' + $port), ('--user-data-dir=' + $profile), $pageUrl
    )
    $chrome = Start-Process -FilePath $browser -ArgumentList $arguments -WindowStyle Hidden -PassThru
    try {
        $page = $null
        for ($attempt = 0; $attempt -lt 120 -and -not $page; $attempt++) {
            try {
                $pages = Invoke-RestMethod ("http://127.0.0.1:$port/json")
                $page = @($pages | Where-Object { $_.type -eq 'page' -and [string]$_.url -like '*index.html*' })[0]
            }
            catch { Start-Sleep -Milliseconds 100 }
        }
        if (-not $page) { throw 'Chrome DevTools index.html target did not become ready.' }

        $webSocketUrl = [string](@($page | ForEach-Object { $_.webSocketDebuggerUrl })[0])
        if (-not $webSocketUrl) { throw 'Chrome page did not expose a WebSocket debugger URL.' }
        $socket = [Net.WebSockets.ClientWebSocket]::new()
        $socket.ConnectAsync([Uri]$webSocketUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        $expression = @'
(async function(){
  function equal(actual,expected,message){if(actual!==expected)throw new Error((message||'values differ')+' (actual='+actual+', expected='+expected+')')}
  function waitFor(check,timeout){var started=Date.now();return new Promise(function(resolve,reject){(function poll(){try{if(check())return resolve()}catch(error){}if(Date.now()-started>timeout)return reject(new Error('timed out'));setTimeout(poll,50)})()})}
  await waitFor(function(){return window.settings&&window.localforage&&window.xiaoshuMailbox&&window.XiaoshuBehaviorCore&&document.getElementById('xs-auto-sticker-settings')},12000);
  var passed=[];
  settings.autoSendEnabled=false;settings.autoStickerEnabled=true;settings.autoStickerInterval=1;manageAutoSendTimer();manageAutoStickerTimer();equal(autoSendTimer===null,true);equal(autoStickerTimer!==null,true);
  settings.autoSendEnabled=true;settings.autoStickerEnabled=false;manageAutoSendTimer();manageAutoStickerTimer();equal(autoSendTimer!==null,true);equal(autoStickerTimer===null,true);
  settings.autoSendEnabled=false;settings.autoStickerEnabled=false;manageAutoSendTimer();manageAutoStickerTimer();passed.push('independent timers');
  var activeKey=getStorageKey('chatSettings'),otherKey=APP_PREFIX+'integration-other_chatSettings';
  await localforage.setItem(otherKey,{autoStickerEnabled:false,fixedCardReplyCount:7});
  settings.autoStickerEnabled=true;settings.autoStickerInterval=9;settings.autoStickerChance=100;settings.randomCardComboEnabled=true;settings.randomCardComboMin=2;settings.randomCardComboMax=3;settings.fixedCardReplyCount=4;
  await saveData({skipChatMessages:true});
  var saved=await localforage.getItem(activeKey),other=await localforage.getItem(otherKey);
  equal(saved.autoStickerEnabled,true);equal(saved.autoStickerInterval,9);equal(saved.autoStickerChance,100);equal(saved.randomCardComboEnabled,true);equal(saved.randomCardComboMin,2);equal(saved.randomCardComboMax,3);equal(saved.fixedCardReplyCount,4);equal(other.autoStickerEnabled,false);equal(other.fixedCardReplyCount,7);passed.push('session persistence');
  var mailboxKey=getStorageKey('mailboxLettersV1'),received={id:'integration-letter',type:'received',title:'Original title',content:'Long original body',createdAt:Date.now(),read:false,originalContent:'',replyToId:'',cardFragments:[]};
  await localforage.setItem(mailboxKey,{version:5,items:[received],pending:[],nextIncomingAt:0,recentCardKeys:[],cardCountMin:2,cardCountMax:4,allowIncomingLetters:false,incomingDelayMinMinutes:720,incomingDelayMaxMinutes:2160,autoReplyEnabled:false,replyDelayMinMinutes:2,replyDelayMaxMinutes:15});
  await xiaoshuMailbox.reload();await xiaoshuMailbox.openLetterById(received.id);document.getElementById('xsMailReply').click();
  equal(document.getElementById('xsMailComposeOriginal'),null);equal(xiaoshuMailbox.getReplyToId(),received.id);equal(document.getElementById('xsMailSubject').value,'\u56de\u590d \u00b7 Original title');equal(document.getElementById('xsMailContent').value,'');
  document.getElementById('xsMailContent').value='My reply';document.getElementById('xsMailSend').click();
  await waitFor(function(){return xiaoshuMailbox.getState().items.some(function(item){return item.type==='sent'})},4000);
  var sent=xiaoshuMailbox.getState().items.filter(function(item){return item.type==='sent'})[0];equal(sent.replyToId,received.id);equal(sent.originalContent,received.content);equal(sent.content,'My reply');
  document.getElementById('xsMailWrite').click();document.getElementById('xsMailSubject').value='Plain letter';document.getElementById('xsMailContent').value='Plain body';document.getElementById('xsMailSend').click();
  await waitFor(function(){return xiaoshuMailbox.getState().items.filter(function(item){return item.type==='sent'}).length===2},4000);
  var plain=xiaoshuMailbox.getState().items.filter(function(item){return item.type==='sent'&&item.content==='Plain body'})[0];equal(plain.replyToId,'');equal(plain.originalContent,'');passed.push('mail reply relation');
  return {ok:true,passed:passed};
})()
'@
        $request = @{ id = 1; method = 'Runtime.evaluate'; params = @{ expression = $expression; awaitPromise = $true; returnByValue = $true } } | ConvertTo-Json -Depth 8 -Compress
        $bytes = [Text.Encoding]::UTF8.GetBytes($request)
        $socket.SendAsync([ArraySegment[byte]]::new($bytes), [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        $builder = [Text.StringBuilder]::new()
        do {
            $buffer = New-Object byte[] 65536
            $received = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
            [void]$builder.Append([Text.Encoding]::UTF8.GetString($buffer, 0, $received.Count))
        } until ($received.EndOfMessage)
        $response = $builder.ToString() | ConvertFrom-Json
        if ($response.result.exceptionDetails) { throw $response.result.exceptionDetails.exception.description }
        $value = $response.result.result.value
        if (-not $value.ok -or $value.passed.Count -ne 3) { throw ('Integration result invalid: ' + ($value | ConvertTo-Json -Compress)) }
        return $value
    }
    finally {
        if ($socket) { try { $socket.Dispose() } catch {} }
        if ($chrome -and -not $chrome.HasExited) { Stop-Process -Id $chrome.Id -Force -ErrorAction SilentlyContinue }
    }
}

try {
    $behavior = Invoke-HeadlessDump (Join-Path $PSScriptRoot 'behavior-regression.html') 'behavior'
    if ($behavior.Html -notmatch 'data-status="passed"' -or $behavior.Html -notmatch 'PASS 13') {
        throw "Behavior regression suite failed.`n$($behavior.Html)"
    }

    $integration = Invoke-CdpIntegrationTest

    $page = Invoke-HeadlessDump (Join-Path $projectRoot 'index.html') 'page' 5000
    foreach ($requiredId in @('xs-auto-sticker-settings', 'xs-auto-sticker-interval', 'xs-auto-sticker-chance', 'xs-card-reply-settings', 'xs-random-card-combo-min', 'xs-random-card-combo-max')) {
        if ($page.Html -notmatch ('id="' + [regex]::Escape($requiredId) + '"')) { throw "Missing rendered control: $requiredId" }
    }
    if ($page.Html -match 'id="xsMailComposeOriginal"') { throw 'Reply compose still renders the original-letter preview.' }
    if ($page.Errors -match '(Uncaught|SyntaxError|ReferenceError|TypeError)') { throw "Page startup error.`n$($page.Errors)" }

    Write-Output 'PASS 13 behavior tests'
    Write-Output 'PASS 3 full-page integration tests'
    Write-Output 'PASS full-page startup and rendered-control checks'
}
finally {
    $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
    $systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolvedTemp.StartsWith($systemTemp, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTemp)) {
        Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
    }
}
