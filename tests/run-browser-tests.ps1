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
  function waitFor(check,timeout,label){var started=Date.now();return new Promise(function(resolve,reject){(function poll(){try{if(check())return resolve()}catch(error){}if(Date.now()-started>timeout)return reject(new Error('timed out: '+label));setTimeout(poll,50)})()})}
  await waitFor(function(){return window.settings&&window.localforage&&window.localforage.__xsStrict&&window.xiaoshuMailbox&&window.XiaoshuBehaviorCore&&window.XiaoshuMediaCore&&window.XiaoshuMediaStorage&&window.xiaoshuSyncBehaviorControls&&document.getElementById('xs-auto-sticker-settings')},12000,'page behavior and media APIs');
  var passed=[];
  var realSaveData=window.saveData,saveCalls=0;
  window.saveData=function(){saveCalls+=1;return Promise.resolve({ok:true})};
  settings.autoStickerEnabled=false;settings.randomCardComboEnabled=false;xiaoshuSyncBehaviorControls();
  var stickerToggle=document.getElementById('xs-auto-sticker-toggle'),stickerControl=document.getElementById('xs-auto-sticker-control');
  stickerToggle.click();equal(stickerToggle.classList.contains('active'),true);equal(stickerControl.style.display,'block');equal(settings.autoStickerEnabled,true);equal(saveCalls,1);equal(autoStickerTimer!==null,true);
  stickerToggle.click();equal(stickerToggle.classList.contains('active'),false);equal(stickerControl.style.display,'none');equal(settings.autoStickerEnabled,false);equal(saveCalls,2);equal(autoStickerTimer===null,true);
  var comboToggle=document.getElementById('xs-random-card-combo-toggle'),fixedControl=document.getElementById('xs-fixed-card-reply-control'),comboControl=document.getElementById('xs-random-card-combo-control');
  comboToggle.click();equal(comboToggle.classList.contains('active'),true);equal(fixedControl.style.display,'none');equal(comboControl.style.display,'block');equal(settings.randomCardComboEnabled,true);equal(saveCalls,3);
  comboToggle.click();equal(comboToggle.classList.contains('active'),false);equal(fixedControl.style.display,'flex');equal(comboControl.style.display,'none');equal(settings.randomCardComboEnabled,false);equal(saveCalls,4);
  var stickerCard=document.getElementById('xs-auto-sticker-settings'),comboCard=document.getElementById('xs-card-reply-settings');stickerCard.replaceWith(stickerCard.cloneNode(true));comboCard.replaceWith(comboCard.cloneNode(true));xiaoshuSyncBehaviorControls();
  stickerToggle=document.getElementById('xs-auto-sticker-toggle');stickerToggle.click();equal(settings.autoStickerEnabled,true,'replacement sticker toggle must change current settings');equal(saveCalls,5,'replacement sticker toggle must fire once');stickerToggle.click();equal(settings.autoStickerEnabled,false);equal(saveCalls,6);
  comboToggle=document.getElementById('xs-random-card-combo-toggle');comboToggle.click();equal(settings.randomCardComboEnabled,true,'replacement combo toggle must change current settings');equal(saveCalls,7,'replacement combo toggle must fire once');comboToggle.click();equal(settings.randomCardComboEnabled,false);equal(saveCalls,8);
  window.dispatchEvent(new CustomEvent('xiaoshu-session-data-ready',{detail:{sessionId:String(SESSION_ID||'')}}));await new Promise(function(resolve){setTimeout(resolve,20)});
  document.getElementById('xs-auto-sticker-toggle').click();equal(settings.autoStickerEnabled,true);equal(saveCalls,9,'session reload click must fire once');document.getElementById('xs-auto-sticker-toggle').click();equal(settings.autoStickerEnabled,false);equal(saveCalls,10);
  window.saveData=realSaveData;passed.push('real delegated toggle clicks');
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
  equal(xiaoshuMailbox.getState().version,6,'version 5 mailbox must migrate to version 6');equal(Array.isArray(xiaoshuMailbox.getState().items[0].images),true);
  equal(document.getElementById('xsMailComposeOriginal'),null);equal(xiaoshuMailbox.getReplyToId(),received.id);equal(document.getElementById('xsMailSubject').value,'\u56de\u590d \u00b7 Original title');equal(document.getElementById('xsMailContent').value,'');
  document.getElementById('xsMailContent').value='My reply';document.getElementById('xsMailSend').click();
  await waitFor(function(){return xiaoshuMailbox.getState().items.some(function(item){return item.type==='sent'})},4000,'reply letter send');
  var sent=xiaoshuMailbox.getState().items.filter(function(item){return item.type==='sent'})[0];equal(sent.replyToId,received.id);equal(sent.originalContent,received.content);equal(sent.content,'My reply');
  document.getElementById('xsMailWrite').click();document.getElementById('xsMailSubject').value='Plain letter';document.getElementById('xsMailContent').value='Plain body';document.getElementById('xsMailSend').click();
  await waitFor(function(){return xiaoshuMailbox.getState().items.filter(function(item){return item.type==='sent'}).length===2},4000,'plain letter send');
  var plain=xiaoshuMailbox.getState().items.filter(function(item){return item.type==='sent'&&item.content==='Plain body'})[0];equal(plain.replyToId,'');equal(plain.originalContent,'');passed.push('mail reply relation');
  async function imageFile(color,name){var canvas=document.createElement('canvas');canvas.width=12;canvas.height=12;var context=canvas.getContext('2d');context.fillStyle=color;context.fillRect(0,0,12,12);var blob=await new Promise(function(resolve){canvas.toBlob(resolve,'image/png')});return new File([blob],name,{type:'image/png'})}
  async function chooseMailImage(color,name){document.getElementById('xsMailWrite').click();var input=document.getElementById('xsMailImagesInput'),file=await imageFile(color,name),transfer=new DataTransfer();transfer.items.add(file);Object.defineProperty(input,'files',{value:transfer.files,configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));await waitFor(function(){return xiaoshuMailbox.getComposeImages().length===1&&!document.getElementById('xsMailSend').disabled},5000,'mail image upload');equal(input.value,'','mail file input must reset for choosing the same file again');return xiaoshuMailbox.getComposeImages()[0]}
  document.getElementById('xsMailWrite').click();var partialInput=document.getElementById('xsMailImagesInput'),partialTransfer=new DataTransfer();partialTransfer.items.add(await imageFile('#a11','partial-one.png'));partialTransfer.items.add(await imageFile('#1a1','partial-two.png'));var realStrictSet=localforage.__xsStrict.setItem,strictWriteCount=0;localforage.__xsStrict.setItem=async function(key,value){strictWriteCount+=1;if(strictWriteCount===2){var quota=new Error('quota full');quota.name='QuotaExceededError';throw quota}return realStrictSet.call(this,key,value)};Object.defineProperty(partialInput,'files',{value:partialTransfer.files,configurable:true});partialInput.dispatchEvent(new Event('change',{bubbles:true}));await waitFor(function(){return !document.getElementById('xsMailSend').disabled&&document.getElementById('xsMailImageStatus').textContent.indexOf('1')!==-1},5000,'partial mail image upload');localforage.__xsStrict.setItem=realStrictSet;equal(xiaoshuMailbox.getComposeImages().length,1,'partial upload must keep only the verified image');equal(partialInput.value,'','multi-file input must reset');document.getElementById('xsMailCancelCompose').click();passed.push('partial upload failure has accurate references');
  var textImageRef=await chooseMailImage('#d22','red.png');document.getElementById('xsMailContent').value='Letter with image';document.getElementById('xsMailSend').click();await waitFor(function(){return xiaoshuMailbox.getState().items.some(function(item){return item.content==='Letter with image'&&item.images.length===1})},5000,'text and image letter send');equal(JSON.stringify(xiaoshuMailbox.getState()).indexOf('data:image/'),-1,'mailbox state must contain references, not image bodies');equal(await localforage.__xsStrict.getItem('kkk35g_mail_media_v1_'+textImageRef)!==null,true,'mail image must persist in IndexedDB');await xiaoshuMailbox.reload();equal(xiaoshuMailbox.getState().items.some(function(item){return item.images.indexOf(textImageRef)!==-1}),true,'mail image reference must survive reload');
  var imageOnlyRef=await chooseMailImage('#25c','blue.png');document.getElementById('xsMailContent').value='';document.getElementById('xsMailSend').click();await waitFor(function(){return xiaoshuMailbox.getState().items.some(function(item){return !item.content&&item.images.indexOf(imageOnlyRef)!==-1})},5000,'image-only letter send');equal(XiaoshuMediaCore.isMailRefForSession(imageOnlyRef,String(SESSION_ID)),true);equal(XiaoshuMediaCore.isMailRefForSession(imageOnlyRef,'different-session'),false);passed.push('mail text-image and image-only persistence');
  var imageOnlyLetter=xiaoshuMailbox.getState().items.find(function(item){return item.images.indexOf(imageOnlyRef)!==-1});await xiaoshuMailbox.openLetterById(imageOnlyLetter.id);var realConfirm=window.confirm;window.confirm=function(){return true};document.getElementById('xsMailViewDelete').click();await waitFor(function(){return !xiaoshuMailbox.getState().items.some(function(item){return item.id===imageOnlyLetter.id})},4000,'image letter delete');await new Promise(function(resolve){setTimeout(resolve,150)});equal(await localforage.__xsStrict.getItem('kkk35g_mail_media_v1_'+imageOnlyRef),null,'unreferenced mail media must be deleted');window.confirm=realConfirm;passed.push('mail media reference cleanup');
  window.kkk35gOpenInteractionTools();var frame=document.getElementById('kkk35gInteractionFrame');await waitFor(function(){return frame&&frame.contentWindow&&frame.contentWindow.xiaoshuInteractionMediaApi},8000,'leaf media API');var leafWindow=frame.contentWindow,leafData='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',leafHub={version:3,modules:{leaf:true,can:false,today:false,tree:false},settings:{canYesRate:72,leafMistapRate:10,todayConfirmRate:70},ui:{fontScale:100},pools:{leaf:[{id:'leaf-migration',question:'image question',options:['A'],images:[leafData]}],askTA:[],taAsksMe:[],today:[],tree:[]},records:[],todayPending:[],drafts:{leaf:null,can:{askTA:null,taAsksMe:null},today:null,todayAnswer:'',todayMode:null,treeDraw:'',treeWrite:''},leafDrawnIds:[],meta:{}};leafWindow.localStorage.setItem('kkk35g_interaction_hub_v1',JSON.stringify(leafHub));await leafWindow.xiaoshuInteractionMediaApi.reload();var migratedLeaf=leafWindow.xiaoshuInteractionMediaApi.getState(),leafRef=migratedLeaf.pools.leaf[0].images[0];equal(/^leafimg_/.test(leafRef),true,'inline leaf image must migrate to a reference');equal(JSON.stringify(migratedLeaf).indexOf('data:image/'),-1,'leaf state must contain references, not image bodies');equal(await localforage.__xsStrict.getItem('kkk35g_interaction_leaf_media_v1_'+leafRef),leafData);await leafWindow.xiaoshuInteractionMediaApi.gc();equal(await localforage.__xsStrict.getItem('kkk35g_interaction_leaf_media_v1_'+leafRef),leafData,'leaf gc must preserve referenced image');passed.push('leaf migration persistence and gc');var leafInput=leafWindow.document.getElementById('leafImagesInput'),leafTransfer=new leafWindow.DataTransfer();leafTransfer.items.add(await imageFile('#333','leaf-fail.png'));var leafRealSet=localforage.__xsStrict.setItem;localforage.__xsStrict.setItem=async function(){var denied=new Error('denied');denied.name='SecurityError';throw denied};Object.defineProperty(leafInput,'files',{value:leafTransfer.files,configurable:true});leafInput.dispatchEvent(new leafWindow.Event('change',{bubbles:true}));await new Promise(function(resolve){setTimeout(resolve,400)});localforage.__xsStrict.setItem=leafRealSet;equal(leafWindow.xiaoshuInteractionMediaApi.getEditingImages().length,0,'failed leaf write must not create a reference or fake preview');equal(leafInput.value,'','leaf input must reset after failure');passed.push('leaf write failure has no fake preview');
  var backup=await ChatBackup.buildBackupPayload();equal(Object.prototype.hasOwnProperty.call(backup.localforage,'kkk35g_mail_media_v1_'+textImageRef),true,'backup must include mail media');equal(Object.prototype.hasOwnProperty.call(backup.localforage,'kkk35g_interaction_leaf_media_v1_'+leafRef),true,'backup must include leaf media');equal(backup.manifest.appMedia.mail>=1,true,'manifest must count mail media');equal(backup.manifest.appMedia.leaf>=1,true,'manifest must count leaf media');var preflight=ChatBackup.preflightBackup(backup);equal(preflight.ok,true,'media backup preflight must pass');await localforage.__xsStrict.removeItem('kkk35g_mail_media_v1_'+textImageRef);await localforage.__xsStrict.removeItem('kkk35g_interaction_leaf_media_v1_'+leafRef);await ChatBackup.applyBackupToStorage(backup,{preflight:preflight,selectedCategoryIds:['chat','interactionHub']});equal(await localforage.__xsStrict.getItem('kkk35g_mail_media_v1_'+textImageRef)!==null,true,'restore must rewrite mail media');equal(await localforage.__xsStrict.getItem('kkk35g_interaction_leaf_media_v1_'+leafRef)!==null,true,'restore must rewrite leaf media');passed.push('media backup restore transaction');
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
        if (-not $value.ok -or $value.passed.Count -ne 10) { throw ('Integration result invalid: ' + ($value | ConvertTo-Json -Compress)) }
        return $value
    }
    finally {
        if ($socket) { try { $socket.Dispose() } catch {} }
        if ($chrome -and -not $chrome.HasExited) { Stop-Process -Id $chrome.Id -Force -ErrorAction SilentlyContinue }
    }
}

try {
    $indexSource = Get-Content -Raw -Encoding utf8 -LiteralPath (Join-Path $projectRoot 'index.html')
    $coreSource = (Get-Content -Raw -Encoding utf8 -LiteralPath (Join-Path $projectRoot 'behavior-core.js')).Trim()
    $inlineMatch = [regex]::Match($indexSource, '(?s)<script id="xiaoshu-behavior-core-inline">\s*(.*?)\s*</script>')
    if (-not $inlineMatch.Success) { throw 'Inline XiaoshuBehaviorCore script is missing.' }
    if ($inlineMatch.Groups[1].Value.Trim() -cne $coreSource) { throw 'Inline XiaoshuBehaviorCore differs from behavior-core.js.' }
    if ($indexSource -match '<script[^>]+src=["'']behavior-core\.js["'']') { throw 'Production page still depends on external behavior-core.js.' }
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'media-core.js'))) { throw 'media-core.js is missing.' }
    if ($indexSource -notmatch '<script src="media-core\.js"></script>') { throw 'Production page does not load media-core.js.' }
    if ($indexSource -notmatch "v124-indexeddb-media-mail-attachments") { throw 'Release marker was not updated to v124.' }
    if ($indexSource -notmatch 'function isStrictMediaKey' -or $indexSource -notmatch 'fallbackSet\(k,v\)\{if\(isStrictMediaKey\(k\)\)') { throw 'Media localStorage fallback guard is missing.' }

    $behavior = Invoke-HeadlessDump (Join-Path $PSScriptRoot 'behavior-regression.html') 'behavior'
    if ($behavior.Html -notmatch 'data-status="passed"' -or $behavior.Html -notmatch 'PASS 13') {
        throw "Behavior regression suite failed.`n$($behavior.Html)"
    }

    $media = Invoke-HeadlessDump (Join-Path $PSScriptRoot 'media-storage-regression.html') 'media-storage'
    if ($media.Html -notmatch 'data-status="passed"' -or $media.Html -notmatch 'PASS 16') {
        throw "Media storage regression suite failed.`n$($media.Html)"
    }

    $integration = Invoke-CdpIntegrationTest

    $page = Invoke-HeadlessDump (Join-Path $projectRoot 'index.html') 'page' 5000
    foreach ($requiredId in @('xs-auto-sticker-settings', 'xs-auto-sticker-interval', 'xs-auto-sticker-chance', 'xs-card-reply-settings', 'xs-random-card-combo-min', 'xs-random-card-combo-max', 'xsMailAddImages', 'xsMailImagesInput', 'xsMailImagePreview', 'xsMailViewImages', 'xsMailImageViewer')) {
        if ($page.Html -notmatch ('id="' + [regex]::Escape($requiredId) + '"')) { throw "Missing rendered control: $requiredId" }
    }
    if ($page.Html -notmatch 'data-xiaoshu-behavior-core="ready"') { throw 'Rendered page did not initialize the inline behavior core.' }
    if ($page.Html -match 'id="xsMailComposeOriginal"') { throw 'Reply compose still renders the original-letter preview.' }
    if ($page.Errors -match '(Uncaught|SyntaxError|ReferenceError|TypeError)') { throw "Page startup error.`n$($page.Errors)" }

    $missingCorePath = Join-Path $tempRoot 'missing-core.html'
    $missingCoreSource = [regex]::Replace($indexSource, '(?s)<script id="xiaoshu-behavior-core-inline">.*?</script>', '', 1)
    Set-Content -LiteralPath $missingCorePath -Value $missingCoreSource -Encoding utf8
    $missingCore = Invoke-HeadlessDump $missingCorePath 'missing-core-result' 5000
    if ($missingCore.Html -notmatch 'data-xiaoshu-behavior-core="error"') { throw 'Missing behavior core was not reported on the document.' }
    foreach ($toggleId in @('xs-auto-sticker-toggle', 'xs-random-card-combo-toggle')) {
        if ($missingCore.Html -notmatch ('id="' + [regex]::Escape($toggleId) + '"[^>]*aria-disabled="true"')) {
            throw "Missing behavior core did not disable and explain control: $toggleId"
        }
    }

    Write-Output 'PASS 13 behavior tests'
    Write-Output 'PASS 16 media storage and migration tests'
    Write-Output 'PASS 10 full-page integration tests'
    Write-Output 'PASS full-page startup and rendered-control checks'
    Write-Output 'PASS inline-core parity and explicit missing-core failure checks'
}
finally {
    $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
    $systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolvedTemp.StartsWith($systemTemp, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTemp)) {
        Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
    }
}
