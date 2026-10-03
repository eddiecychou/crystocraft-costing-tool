// SEO control plane — Step 3, the validation gate.
//
// SSOT for "is this WordPress write payload safe to apply". Deterministic,
// pure (no I/O, no deps) — the DeepSeek Workbench vendors this file verbatim
// and runs every translation / generation payload through it BEFORE the write
// (and attaches the result as the `validation` field on each seo_batches
// item). When a new failure mode appears, a check is added HERE and the
// Workbench re-vendors.
//
// Every check maps to a Workbench LESSONS-LEARNED entry:
//   json_parses .............. B32
//   widget_count ............. B20 (stale-copy), §6.5
//   element_ids_preserved .... §3d, §6.5
//   length_anomaly ........... B6, §8b.1
//   wrong_language_chars ..... B33 / B35 (CJK leak in es/fr), simplified-in-zh-hant
//                              (the zh-hant guard is DERIVED from OpenCC, not
//                              hand-picked — see the SIMPLIFIED constant; B51/B53
//                              trimmed 6 forms by hand and L-49 replaced that with
//                              a derivation, which needs no exemptions),
//                              simplified-in-ja (B54 — ja uses its own
//                              Chinese-only list, not the zh-hant set)
//   placeholder_markers ...... B12; fr/ja/zh-hant coverage added L-29 (this
//                              repo's LESSONS-LEARNED.md) — was en/es/zh-hans
//                              only, missing 3 of the 6 languages this site
//                              actually publishes in
//   brand_terms_preserved .... §3c, §8b.5, B53 (ignore Yoast head + JSON-LD;
//                              source text is the RAW body, never `.rendered` —
//                              L-47)
//   sku_prefix_preserved ..... B12 (SKU-preserving name translation)
//   image_count_parity ....... §2 payload validation (RAW body on both sides)
//   heading_count_parity ..... §2 (RAW body on both sides — a live entity's
//                              `.rendered` is the built Elementor page and can
//                              never match a raw payload body; 2026-10-03)
//   no_new_scripts_or_tables . §2 (RAW body on both sides — `.rendered` carries
//                              Yoast's inline JSON-LD, which used to suppress
//                              the check entirely)
//
// The RAW-body rule is one rule, not three: `contentString()` is used by the
// three checks above AND by `payloadText()` (which feeds the language /
// placeholder / brand scans). An object field contributes `.raw` only, and an
// absent `.raw` means "no authored body — nothing to compare", so the check
// SKIPS rather than falling back to the render. Fixing it at only some call
// sites is how L-47 happened; when this class of bug appears, grep for the
// pattern rather than patching the site that was reported.
//   seo_title_no_double_brand . L-09, MASTER §4
//   seo_desc_length .......... §4, B47
//   translation_draft_only ... Rule 4 (never publish an unlinked translation)
//
// Usage:
//   import { validatePayload } from './validate-payload.mjs'
//   const v = validatePayload({ kind, lang, endpoint, payload, source })
//   if (!v.passed) throw new Error('validation failed: ' + v.checks.filter(c=>!c.ok).map(c=>c.name).join(', '))

// ── config ────────────────────────────────────────────────────────────────
export const BRAND_TERMS = ['Swarovski', 'Crystocraft', 'MagSafe', 'NFC', 'CrystoCoin', 'iPhone']

// zh-hant guard: simplified-ONLY forms that must never appear in a zh-hant
// payload. DERIVED, never hand-picked — from OpenCC's STCharacters.txt, a
// character `s` is simplified-only when the mapping actually changes it
// (trad[0] !== s) AND `s` does not itself occur on the traditional side of any
// mapping. That second test excludes the ambiguous forms automatically (台 只 里
// 后 云 谷 回 价 …), so the six that used to be special-cased here (只 繁 慕 谷
// 回 台, B51/B53) need no exemption. Also excluded: 床 秘 群 峰 — OpenCC's ST
// dictionary normalises orthographic VARIANTS too (床 -> 牀), where the
// left-hand character is standard Traditional, so flagging them would be a false
// alarm on correct text.
//
// 3,803 characters. The hand-curated 193-character list this replaced (L-49)
// missed 3,617 of them (95.1%) — including 订 礼, so 訂製 and 禮品 passed the
// guard — and flagged seven that ARE valid Traditional (云 厂 叶 后 广 征 种, as
// in 皇后 / 征戰), so it rejected correct text.
//
// MUST be iterated by CODE POINT — `new Set(SIMPLIFIED)` and `[...text]` both
// are. `s.length` / `charCodeAt` would drop this list's 1,141 CJK Extension-B
// characters (U+20000+).
// Regenerate + verify: node scripts/derive-zh-hant-simplified.mjs --check
// (exported so the test can assert its size — a truncated guard is a silent
// loss of coverage, which is the whole of L-49.)
export const SIMPLIFIED = '㐷㐽㑇㑈㑔㑩㓆㓥㓰㔉㖊㖞㘎㚯㛀㛟㛠㛣㛤㛿㟆㟜㟥㡎㤘㤽㥪㧏㧐㧑㧟㧰㨫㭎㭏㭣㭤㭴㱩㱮㲿㳔㳕㳠㳡㳢㳽㴋㶉㶶㶽㺍㻅㻏㻘䀥䁖䂵䃅䅉䅟䅪䇲䉤䌶䌷䌸䌹䌺䌻䌼䌽䌾䌿䍀䍁䍠䎬䏝䑽䓓䓕䓖䓨䗖䘛䘞䙊䙌䙓䜣䜤䜥䜧䜩䝙䞌䞍䞎䞐䟢䢀䢁䢂䥺䥽䥾䥿䦀䦁䦂䦃䦅䦆䦶䦷䩄䭪䯃䯄䯅䲝䲞䲟䲠䲡䲢䲣䴓䴔䴕䴖䴗䴘䴙䶮与专业丛东丝丢两严丧个临为丽举么义乌乐乔习乡书买乱争亏亚产亩亲亵亸亿仅从仑仓仪们众优会伛伞伟传伡伣伤伥伦伧伪伫体佥侠侣侥侦侧侨侩侪侬侭俣俦俨俩俪俫俭债倾偬偻偾偿傤傥傧储傩儿兑兖兰关兴兹养兽冁内冈册写军农冯冲决况冻净凄凉减凑凛凤凫凭凯击凿刍刘则刚创删别刬刭刹刽刾刿剀剂剐剑剥剧劝办务劢动励劲劳势勋勚匀匦匮区医华协单卖卢卤卧卫却卺厅历厉压厌厍厐厕厢厣厦厨厩厮县叁参叆叇双发变叙叠号叹叽吓吕吗吨听启吴呐呒呓呕呖呗员呙呛呜咏咙咛咝咤响哑哒哓哔哕哗哙哜哝哟唛唝唠唡唢唤啧啬啭啮啯啰啴啸喷喽喾嗫嗳嘘嘤嘱噜嚣团园囱围囵国图圆圣圹场块坚坛坜坝坞坟坠垄垅垆垒垦垩垫垭垯垱垲垴埘埙埚堑堕塆墙壮声壳壶壸处备复够头夹夺奁奂奋奖奥妆妇妈妩妪妫姗姹娄娅娆娇娈娱娲娴婳婴婵婶媪媭嫒嫔嫱嬷孙学孪宁宝实宠审宪宫宽宾寝对寻导寿将尔尘尝尧尴尽层屃屉届属屡屦屿岁岂岖岗岘岚岛岭岽岿峃峄峡峣峤峥峦崂崃崄崭嵘嵚嵝巅巩巯币帅师帏帐帜带帧帮帱帻帼幂并庄庆庐庑库应庙庞废庼廪开异弃弑张弥弪弯弹强归当录彟彦彨彻径徕忆忏忧忾怀态怂怃怄怅怆怜总怼怿恋恒恳恶恸恹恺恻恼恽悦悫悬悭悮悯惊惧惨惩惫惬惭惮惯愠愤愦慑慭懑懒懔戆戋戏戗战戬戯户扑执扩扪扫扬扰抚抛抟抠抡抢护报担拟拢拣拥拦拧拨择挚挛挜挝挞挟挠挡挢挣挤挥挦捝捞损捡换捣掳掴掷掸掺掼揽揾揿搀搁搂搄搅携摄摅摆摇摈摊撄撑撵撷撸撺擜擞攒敌敚敛敩数斋斓斩断无旧时旷旸昙昵昼昽显晋晒晓晔晕晖暂暅暧术机杀杂权条来杨杩构枞枢枣枥枧枨枪枫枭柠柽栀栅标栈栉栊栋栌栎栏树栖样栾桠桡桢档桤桥桦桧桨桩桪梦梼梾梿检棁棂椁椝椟椠椢椤椫椭椮楼榄榅榇榈榉榝槚槛槟槠横樯樱橥橱橹橼檩欢欤欧歼殁殇残殒殓殚殡殴毁毂毕毙毡毵毶氇气氢氩氲汇汉汤汹沄沟没沣沤沥沦沧沨沩沪泞泪泶泷泸泺泻泼泽泾洁洒洼浃浅浆浇浈浉浊测浍济浏浐浑浒浓浔浕涚涛涝涞涟涠涡涢涣涤润涧涨涩渊渌渍渎渐渑渔渖渗温湾湿溁溃溅溆溇滗滚滞滟滠满滢滤滥滦滨滩滪潆潇潋潍潜潴澛澜濑濒灏灭灯灵灶灾灿炀炉炖炜炝点炼炽烁烂烃烛烟烦烧烨烩烫烬热焕焖焘煴爱爷牍牦牵牺犊状犷犸犹狈狝狞独狭狮狯狰狱狲猃猎猕猡猪猫猬献獭玑玙玚玛玮环现玱玺珐珑珰珲琎琏琐琼瑶瑷瑸璎瓒瓮瓯电画畅畴疖疗疟疠疡疬疭疮疯疱疴痈痉痒痖痨痪痫痴瘅瘆瘗瘘瘪瘫瘾瘿癞癣癫皑皱皲盏盐监盖盗盘眍眦眬睁睐睑瞆瞒瞩矫矶矾矿砀码砖砗砚砜砺砻砾础硁硕硖硗硙硚硵碍碛碜碱礼祃祎祢祯祷祸禀禄禅离秃秆积称秽秾稆税稣稳穑穞穷窃窍窎窑窜窝窥窦窭竖竞笃笋笔笕笺笼笾筚筛筜筝筹筼签筿简箓箦箧箨箩箪箫篑篓篮篯篱簖籁籴类籼粜粝粤粪粮粽糁糇糍紧絷緼縆纟纠纡红纣纤纥约级纨纩纪纫纬纭纮纯纰纱纲纳纴纵纶纷纸纹纺纻纼纽纾线绀绁绂练组绅细织终绉绊绋绌绍绎经绐绑绒结绔绕绖绗绘给绚绛络绝绞统绠绡绢绣绤绥绦继绨绩绪绫绬续绮绯绰绱绲绳维绵绶绷绸绹绺绻综绽绾绿缀缁缂缃缄缅缆缇缈缉缊缋缌缍缎缏缐缑缒缓缔缕编缗缘缙缚缛缜缝缞缟缠缡缢缣缤缥缦缧缨缩缪缫缬缭缮缯缰缱缲缳缴缵罂网罗罚罢罴羁羟羡翘翙翚耢耧耸耻聂聋职聍联聩聪肃肠肤肮肴肾肿胀胁胆胧胨胪胫胶脉脍脏脐脑脓脔脚脱脶脸腘腭腻腼腽腾膑臜舆舣舰舱舻艰艳艺节芈芗芜芦苁苇苈苋苌苍苎苏茎茏茑茔茕茧荆荙荚荛荜荝荞荟荠荡荣荤荥荦荧荨荩荪荫荬荭荮药莅莱莲莳莴莶获莸莹莺莼萚萝萤营萦萧萨葱蒀蒇蒉蒋蒌蒏蓝蓟蓠蓣蓥蓦蔂蔷蔹蔺蔼蕰蕲蕴薮藓藴蘖虏虑虚虬虮虱虽虾虿蚀蚁蚂蚃蚕蚬蛊蛎蛏蛮蛰蛱蛲蛳蛴蜕蜗蝇蝈蝉蝼蝾螀螨蟏衅衔补衬衮袄袅袆袜袭袯装裆裈裢裣裤裥褛褴襕见观觃规觅视觇览觉觊觋觌觍觎觏觐觑觞触觯訚詟誉誊讠计订讣认讥讦讧讨让讪讫讬训议讯记讱讲讳讴讵讶讷许讹论讻讼讽设访诀证诂诃评诅识诇诈诉诊诋诌词诎诏诐译诒诓诔试诖诗诘诙诚诛诜话诞诟诠诡询诣诤该详诧诨诩诪诫诬语诮误诰诱诲诳说诵诶请诸诹诺读诼诽课诿谀谁谂调谄谅谆谇谈谉谊谋谌谍谎谏谐谑谒谓谔谕谖谗谘谙谚谛谜谝谞谟谠谡谢谣谤谥谦谧谨谩谪谫谬谭谮谯谰谱谲谳谴谵谶豮贝贞负贠贡财责贤败账货质贩贪贫贬购贮贯贰贱贲贳贴贵贶贷贸费贺贻贼贽贾贿赀赁赂赃资赅赆赇赈赉赊赋赌赍赎赏赐赑赒赓赔赕赖赗赘赙赚赛赜赝赞赟赠赡赢赣赪赵赶趋趱趸跃跄跞践跶跷跸跹跻踌踪踬踯蹑蹒蹰蹿躏躜躯輼车轧轨轩轪轫转轭轮软轰轱轲轳轴轵轶轷轸轹轺轻轼载轾轿辀辁辂较辄辅辆辇辈辉辊辋辌辍辎辏辐辑辒输辔辕辖辗辘辙辚辞辩辫边辽达迁过迈运还这进远违连迟迩迳迹选逊递逦逻遗遥邓邝邬邮邹邺邻郏郐郑郓郦郧郸酂酝酦酱酽酾酿醖释鉴銮錾钅钆钇针钉钊钋钌钍钎钏钐钑钒钓钔钕钖钗钘钙钚钛钜钝钞钟钠钡钢钣钤钥钦钧钨钩钪钫钬钭钮钯钰钱钲钳钴钵钶钷钸钹钺钻钼钽钾钿铀铁铂铃铄铅铆铇铈铉铊铋铌铍铎铏铐铑铒铓铔铕铖铗铘铙铚铛铜铝铞铟铠铡铢铣铤铥铦铧铨铩铪铫铬铭铮铯铰铱铲铳铴铵银铷铸铹铺铻铼铽链铿销锁锂锃锄锅锆锇锈锉锊锋锌锍锎锏锐锑锒锓锔锕锖锗锘错锚锛锜锝锞锟锠锡锢锣锤锥锦锧锨锩锪锫锬锭键锯锰锱锲锳锴锵锶锷锸锹锺锻锼锽锾锿镀镁镂镃镄镅镆镇镈镉镊镋镌镍镎镏镐镑镒镓镔镕镖镗镘镙镚镛镜镝镞镟镠镡镢镣镤镥镦镧镨镩镪镫镬镭镮镯镰镱镲镳镴镵镶长门闩闪闫闬闭问闯闰闱闲闳间闵闶闷闸闹闺闻闼闽闾闿阀阁阂阃阄阅阆阇阈阉阊阋阌阍阎阏阐阑阒阓阔阕阖阗阘阙阚阛队阳阴阵阶际陆陇陈陉陕陦陧陨险随隐隶隽难雏雠雳雾霁霉霡霭靓靔静靥鞑鞒鞯鞲韦韧韨韩韪韫韬韵页顶顷顸项顺须顼顽顾顿颀颁颂颃预颅领颇颈颉颊颋颌颍颎颏颐频颒颓颔颕颖颗题颙颚颛颜额颞颟颠颡颢颣颤颥颦颧风飏飐飑飒飓飔飕飖飗飘飙飚飞飨餍饣饤饥饦饧饨饩饪饫饬饭饮饯饰饱饲饳饴饵饶饷饸饹饺饻饼饽饾饿馀馁馂馃馄馅馆馇馈馉馊馋馌馍馎馏馐馑馒馓馔馕马驭驮驯驰驱驲驳驴驵驶驷驸驹驺驻驼驽驾驿骀骁骂骃骄骅骆骇骈骉骊骋验骍骎骏骐骑骒骓骔骕骖骗骘骙骚骛骜骝骞骟骠骡骢骣骤骥骦骧髅髋髌鬓鬶魇魉鱼鱽鱾鱿鲀鲁鲂鲃鲄鲅鲆鲇鲈鲉鲊鲋鲌鲍鲎鲏鲐鲑鲒鲓鲔鲕鲖鲗鲘鲙鲚鲛鲜鲝鲞鲟鲠鲡鲢鲣鲤鲥鲦鲧鲨鲩鲪鲫鲬鲭鲮鲯鲰鲱鲲鲳鲴鲵鲶鲷鲸鲹鲺鲻鲼鲽鲾鲿鳀鳁鳂鳃鳄鳅鳆鳇鳈鳉鳊鳋鳌鳍鳎鳏鳐鳑鳒鳓鳔鳕鳖鳗鳘鳙鳚鳛鳜鳝鳞鳟鳠鳡鳢鳣鳤鸟鸠鸡鸢鸣鸤鸥鸦鸧鸨鸩鸪鸫鸬鸭鸮鸯鸰鸱鸲鸳鸴鸵鸶鸷鸸鸹鸺鸻鸼鸽鸾鸿鹀鹁鹂鹃鹄鹅鹆鹇鹈鹉鹊鹋鹌鹍鹎鹏鹐鹑鹒鹓鹔鹕鹖鹗鹘鹙鹚鹛鹜鹝鹞鹟鹠鹡鹢鹣鹤鹥鹦鹧鹨鹩鹪鹫鹬鹭鹮鹯鹰鹱鹲鹳鹴鹾麦麸麹麺麽黄黉黡黩黪黾鼋鼌鼍鼹齐齑齿龀龁龂龃龄龅龆龇龈龉龊龋龌龙龚龛龟鿎鿏鿒鿔𠀾𠆲𠆿𠇹𠉂𠉗𠋆𠚳𠛅𠛆𠛾𠡠𠮶𠯟𠯠𠰱𠰷𠱞𠲥𠴛𠴢𠵸𠵾𡋀𡋗𡋤𡍣𡒄𡝠𡞋𡞱𡠟𡥧𡭜𡭬𡳃𡳒𡶴𡸃𡺃𡺄𢋈𢗓𢘙𢘝𢘞𢙏𢙐𢙑𢙒𢙓𢛯𢠁𢢐𢧐𢫊𢫞𢫬𢬍𢬦𢭏𢽾𣃁𣆐𣈣𣍨𣍯𣍰𣎑𣏢𣐕𣐤𣑶𣒌𣓿𣔌𣗊𣗋𣗙𣘐𣘓𣘴𣘷𣚚𣞎𣨼𣭤𣯣𣱝𣲗𣲘𣳆𣶩𣶫𣶭𣷷𣸣𣺼𣺽𣽷𤆡𤆢𤇃𤇄𤇭𤇹𤈶𤈷𤊀𤊰𤋏𤎺𤎻𤙯𤝢𤞃𤞤𤠋𤦀𤩽𤳄𤶊𤶧𤻊𤽯𤾀𤿲𥁢𥅘𥅴𥅿𥆧𥇢𥎝𥐟𥐯𥐰𥐻𥞦𥧂𥩟𥩺𥫣𥬀𥬞𥬠𥭉𥮋𥮜𥮾𥱔𥹥𥺅𥺇𦈈𦈉𦈋𦈌𦈎𦈏𦈐𦈑𦈒𦈓𦈔𦈕𦈖𦈗𦈘𦈙𦈚𦈛𦈜𦈝𦈞𦈟𦈠𦈡𦍠𦛨𦝼𦟗𦨩𦰏𦰴𦶟𦶻𦻕𧉐𧉞𧌥𧏖𧏗𧑏𧒭𧜭𧝝𧝧𧮪𧳕𧹑𧹒𧹓𧹔𧹕𧹖𧹗𧿈𨀁𨀱𨁴𨂺𨄄𨅛𨅫𨅬𨉗𨐅𨐆𨐇𨐈𨐉𨐊𨑹𨟳𨠨𨡙𨡺𨤰𨰾𨰿𨱀𨱁𨱂𨱃𨱄𨱅𨱆𨱇𨱈𨱉𨱊𨱋𨱌𨱍𨱎𨱏𨱐𨱑𨱒𨱓𨱔𨱕𨱖𨷿𨸀𨸁𨸂𨸃𨸄𨸅𨸆𨸇𨸉𨸊𨸋𨸌𨸎𨸘𨸟𩏼𩏽𩏾𩏿𩐀𩓋𩖕𩖖𩖗𩙥𩙦𩙧𩙨𩙩𩙪𩙫𩙬𩙭𩙮𩙯𩙰𩟿𩠀𩠁𩠂𩠃𩠅𩠆𩠇𩠈𩠉𩠊𩠋𩠌𩠎𩠏𩠠𩡖𩧦𩧨𩧩𩧪𩧫𩧬𩧭𩧮𩧯𩧰𩧱𩧲𩧳𩧴𩧵𩧶𩧸𩧺𩧻𩧼𩧿𩨀𩨁𩨂𩨃𩨄𩨅𩨆𩨇𩨈𩨉𩨊𩨋𩨌𩨍𩨎𩨏𩨐𩩈𩬣𩬤𩭹𩯒𩰰𩲒𩴌𩽹𩽺𩽻𩽼𩽽𩽾𩽿𩾁𩾂𩾃𩾄𩾅𩾆𩾇𩾈𩾊𩾋𩾌𩾎𪉂𪉃𪉄𪉅𪉆𪉈𪉉𪉊𪉋𪉌𪉍𪉎𪉏𪉐𪉑𪉒𪉔𪉕𪎈𪎉𪎊𪎋𪎌𪑅𪔭𪚏𪚐𪜎𪞝𪟎𪟝𪠀𪠟𪠡𪠳𪠵𪠸𪠺𪠽𪡀𪡃𪡋𪡏𪡛𪡞𪡺𪢌𪢐𪢒𪢕𪢖𪢠𪢮𪢸𪣆𪣒𪣻𪤄𪤚𪥠𪥫𪥰𪥿𪧀𪧘𪨊𪨗𪨧𪨩𪨶𪨷𪨹𪩇𪩎𪩘𪩛𪩷𪩸𪪏𪪑𪪞𪪴𪪼𪫌𪫡𪫷𪫺𪬚𪬯𪭝𪭢𪭧𪭯𪭵𪭾𪮃𪮋𪮖𪮳𪮶𪯋𪰶𪱥𪱷𪲎𪲔𪲛𪲮𪳍𪳗𪴙𪵑𪵣𪵱𪶄𪶒𪶮𪷍𪷽𪸕𪸩𪹀𪹠𪹳𪹹𪺣𪺪𪺭𪺷𪺸𪺻𪺽𪻐𪻨𪻲𪻺𪼋𪼴𪽈𪽝𪽪𪽭𪽮𪽴𪽷𪾔𪾢𪾣𪾦𪾸𪿊𪿞𪿫𪿵𫀌𫀓𫀨𫀬𫀮𫁂𫁟𫁡𫁱𫁲𫁳𫁷𫁺𫂃𫂆𫂈𫂖𫂿𫃗𫄙𫄚𫄛𫄜𫄝𫄞𫄟𫄠𫄡𫄢𫄣𫄤𫄥𫄦𫄧𫄨𫄩𫄪𫄫𫄬𫄭𫄮𫄯𫄰𫄱𫄲𫄳𫄴𫄵𫄶𫄷𫄸𫄹𫅅𫅗𫅥𫅭𫅼𫆏𫆝𫆫𫇘𫇛𫇪𫇭𫇴𫇽𫈉𫈎𫈟𫈵𫉁𫉄𫊪𫊮𫊸𫊹𫊻𫋇𫋌𫋲𫋷𫋹𫋻𫌀𫌇𫌋𫌨𫌪𫌫𫌬𫌭𫌯𫍐𫍙𫍚𫍛𫍜𫍝𫍞𫍟𫍠𫍡𫍢𫍣𫍤𫍥𫍦𫍧𫍨𫍩𫍪𫍫𫍬𫍭𫍮𫍯𫍰𫍱𫍲𫍳𫍴𫍵𫍶𫍷𫍸𫍹𫍺𫍻𫍼𫍽𫍾𫍿𫎆𫎌𫎦𫎧𫎨𫎩𫎪𫎫𫎬𫎭𫎱𫎳𫎸𫎺𫏃𫏆𫏋𫏌𫏐𫏑𫏕𫏞𫏨𫐄𫐅𫐆𫐇𫐈𫐉𫐊𫐋𫐌𫐍𫐎𫐏𫐐𫐑𫐒𫐓𫐔𫐕𫐖𫐗𫐘𫐙𫐷𫑘𫑡𫑷𫓥𫓦𫓧𫓨𫓩𫓪𫓫𫓬𫓭𫓮𫓯𫓰𫓱𫓲𫓳𫓴𫓵𫓶𫓷𫓸𫓹𫓺𫓻𫓼𫓽𫓾𫓿𫔀𫔁𫔂𫔃𫔄𫔅𫔆𫔇𫔈𫔉𫔊𫔋𫔌𫔍𫔎𫔏𫔐𫔑𫔒𫔓𫔔𫔕𫔖𫔭𫔮𫔯𫔰𫔲𫔴𫔵𫔶𫔽𫕚𫕥𫕨𫖃𫖅𫖇𫖑𫖒𫖓𫖔𫖕𫖖𫖪𫖫𫖬𫖭𫖮𫖯𫖰𫖱𫖲𫖳𫖴𫖵𫖶𫖷𫖸𫖹𫖺𫗇𫗈𫗉𫗊𫗋𫗚𫗞𫗟𫗠𫗡𫗢𫗣𫗤𫗥𫗦𫗧𫗨𫗩𫗪𫗫𫗬𫗭𫗮𫗯𫗰𫗱𫗳𫗴𫗵𫘛𫘜𫘝𫘞𫘟𫘠𫘡𫘣𫘤𫘥𫘦𫘧𫘨𫘩𫘪𫘫𫘬𫘭𫘮𫘯𫘰𫘱𫘽𫙂𫚈𫚉𫚊𫚋𫚌𫚍𫚎𫚏𫚐𫚑𫚒𫚓𫚔𫚕𫚖𫚗𫚘𫚙𫚚𫚛𫚜𫚝𫚞𫚟𫚠𫚡𫚢𫚣𫚤𫚥𫚦𫚧𫚨𫚩𫚪𫚫𫚬𫚭𫛚𫛛𫛜𫛝𫛞𫛟𫛠𫛡𫛢𫛣𫛤𫛥𫛦𫛧𫛨𫛩𫛪𫛫𫛬𫛭𫛮𫛯𫛰𫛱𫛲𫛳𫛴𫛵𫛶𫛷𫛸𫛹𫛺𫛻𫛼𫛽𫛾𫜀𫜁𫜂𫜃𫜄𫜅𫜊𫜑𫜒𫜓𫜔𫜕𫜙𫜟𫜨𫜩𫜪𫜫𫜬𫜭𫜮𫜯𫜰𫜲𫜳𫝈𫝋𫝦𫝧𫝨𫝩𫝪𫝫𫝬𫝭𫝮𫝵𫞅𫞗𫞚𫞛𫞝𫞠𫞡𫞢𫞣𫞥𫞦𫞧𫞨𫞩𫞷𫟃𫟄𫟅𫟆𫟇𫟑𫟕𫟞𫟟𫟠𫟡𫟢𫟤𫟥𫟦𫟫𫟬𫟲𫟳𫟴𫟵𫟶𫟷𫟸𫟹𫟺𫟻𫟼𫟽𫟾𫟿𫠀𫠁𫠂𫠅𫠆𫠇𫠈𫠊𫠋𫠌𫠏𫠐𫠑𫠒𫠖𫠜𫢸𫧃𫧮𫫇𫬐𫭟𫭢𫭼𫮃𫰛𫵷𫶇𫷷𫸩𬀩𬀪𬂩𬃊𬇕𬇙𬇹𬉼𬊈𬊤𬍛𬍡𬍤𬒈𬒗𬕂𬘓𬘘𬘡𬘩𬘫𬘬𬘭𬘯𬙂𬙊𬙋𬜬𬜯𬞟𬟁𬟽𬣙𬣞𬣡𬣳𬤇𬤊𬤝𬨂𬨎𬩽𬪩𬬩𬬭𬬮𬬱𬬸𬬹𬬻𬬿𬭁𬭊𬭎𬭚𬭛𬭤𬭩𬭬𬭭𬭯𬭳𬭶𬭸𬭼𬮱𬮿𬯀𬯎𬱖𬱟𬳵𬳶𬳽𬳿𬴂𬴃𬴊𬶋𬶍𬶏𬶐𬶟𬶠𬶨𬶭𬶮𬷕𬸘𬸚𬸣𬸦𬸪𬸯𬹼𬺈𬺓𰬸𰰨𰶎𰻝𰾄𰾭𱊜'

// ja guard: a curated Chinese-ONLY list. The zh-hant SIMPLIFIED set above is
// ~90% valid Japanese kanji (国 台 宝 当 属 回 号 寿 写 声 将 强 红 级 结 约 …),
// so reusing it false-flagged every ja payload (B54). This list is the subset
// that is genuinely PRC-simplified and not standard Japanese.
const SIMPLIFIED_JA = '这们个为时说话马鸟鱼龙电东书农华单卖卫历压厂严县团园图处备实对寻导尔尘岁帐币帮广应庙库张弹归录彻从态怀忆忧怜恼恳悬惯懒戏积纽练组细网纵纠购贡穷货质费账贺贷贸宾赞页顿预频颇领顾显题颜飞饱饮养骄验选锦钟针锋铸闲阅陆陈隐难虽马验观复么头车'

const PLACEHOLDER_RX = /\b(please provide|translate this|as an ai|i cannot|i['’]m sorry|lorem ipsum|todo:)\b|请提供|请输入|需要翻译|\[placeholder\]/i
// "por favor" on its own is polite Spanish, NOT a marker — "por favor
// contáctenos" / "por favor complete el formulario" are common in real es
// copy (B51). Only flag it when it introduces a translator / AI instruction
// that leaked into the output ("Por favor, proporcione la traducción…").
// Optional punctuation is allowed between the two parts (comma fix).
const SPANISH_INSTRUCTION_RX = /\bpor favor[\s,.;:¡!¿?—–-]*(traduc|traduzc|proporcion|complet|rellen|introduzc|escrib(?:a|e|an)\b|redact|revis|provee|añad|inserta|reempl)/i
// L-29 (2026-09-23, Workbench handoff): PLACEHOLDER_RX had zero fr/ja
// coverage and zh-only simplified forms — 28 of 29 leaked translator-
// instruction excerpts sitewide could not have been caught by any check
// that existed before this. Same co-occurrence shape as SPANISH_INSTRUCTION_RX
// above: a request/imperative marker AND a translation stem, not either
// alone — a bare "veuillez indiquer" (checkout copy) or "請提供您的訂單編號"
// (a real form field) is ordinary commerce language, not a leak. A v1 draft
// that flagged the markers unconditionally caught all leaks but false-
// positived on exactly that kind of real copy.
const FRENCH_INSTRUCTION_RX = /(veuillez|merci de|fournir|fournissez|envoyer|envoyez|saisir|saisissez|coller|collez|indiquer|indiquez|transmettre|transmettez)\b[^.]{0,80}(traduire|traduisez|traduction|traduit|à traduire|a traduire)/i
const JAPANESE_INSTRUCTION_RX = /(翻訳する|翻訳の|訳す|翻訳したい)[^。]{0,20}(テキスト|文章|文)[^。]{0,10}(提供|入力|送信|貼り付け)|テキストを提供してください|翻訳してください|翻訳して(ください|下さい)/
// zh-hant is first-class on this site (52 published posts) but PLACEHOLDER_RX's
// 请提供/请输入/需要翻译 are simplified-only — their traditional forms
// (請提供/請輸入/需要翻譯) never matched. Gated on a translation term for the
// same reason as the fr/ja patterns above.
const TRADITIONAL_ZH_INSTRUCTION_RX = /(請提供|請輸入|請貼上)[^。]{0,20}(翻譯|譯文|譯)|需要翻譯|翻譯[^。]{0,15}(文字|內容|文本|資料)/
const CJK_RX = /[぀-ヿ㐀-鿿豈-﫿]/         // hiragana/katakana + CJK ideographs
const SCRIPT_RX = /<script[\s>]/i
const TABLE_RX = /<table[\s>]/i

// ── helpers ───────────────────────────────────────────────────────────────
const asString = (v) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v))

function parseElementor(v) {
  if (v == null) return null
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return undefined } // undefined = present-but-broken
}

// Walk an Elementor tree, yielding every node.
function* walk(node) {
  if (!node) return
  if (Array.isArray(node)) { for (const n of node) yield* walk(n) ; return }
  yield node
  if (node.elements) yield* walk(node.elements)
}
const isWidget = (n) => n && (n.elType === 'widget' || n.widgetType)
const TEXT_SETTING_KEYS = ['title', 'editor', 'heading', 'text', 'title_text', 'description_text', 'caption', 'button_text']

function widgetTexts(tree) {
  const out = []
  for (const n of walk(tree)) {
    if (!isWidget(n) || !n.settings) continue
    for (const k of TEXT_SETTING_KEYS) {
      if (typeof n.settings[k] === 'string' && n.settings[k].trim()) out.push({ id: n.id, key: k, text: n.settings[k] })
    }
  }
  return out
}
function elementIds(tree) {
  const s = new Set()
  for (const n of walk(tree)) if (n && n.id) s.add(n.id)
  return s
}

// Collect all human-readable text in a payload (top-level string fields +
// decoded Elementor widget text). Used for the language / placeholder / brand
// scans — on BOTH sides (`text` = payload, `srcText` = source).
function payloadText(payload) {
  const parts = []
  for (const [k, v] of Object.entries(payload || {})) {
    // `meta` is walked selectively below. `yoast_head` / `yoast_head_json` are
    // Yoast's GENERATED head (og tags + JSON-LD) that WooCommerce echoes back
    // read-only — its `"name":"Crystocraft"` etc. was false-flagging
    // brand_terms_preserved and leaking stray chars into the language scan (B53).
    //
    // `meta.*` (dotted) is the same data in the FLAT `before`-snapshot shape.
    // It is skipped for the same reason `meta` is: the Elementor tree is walked
    // selectively below, and a raw 50 KB Elementor JSON pushed as text drags in
    // container settings, image filenames and alt text that `widgetTexts`
    // deliberately excludes — which made `brand_terms_preserved` unsatisfiable
    // (L-48). `normalizeEntity` folds these keys away before we get here; this
    // is the belt-and-braces guard so the leak cannot come back.
    if (k === 'meta' || k.startsWith('meta.') || k === 'yoast_head' || k === 'yoast_head_json') continue
    if (typeof v === 'string') parts.push(v)
    // An object field is a REST `{ rendered, raw }` (a live entity's content /
    // excerpt / title). It MUST go through contentString so it contributes its
    // RAW body: `.rendered` is the whole built page, and counting it as source
    // text made `brand_terms_preserved` unsatisfiable — the render carries brand
    // names in image filenames, alt text and links that the payload body cannot
    // (2026-10-03 follow-up; same false-flag class as `yoast_head` above, L-47).
    else if (v && typeof v === 'object') parts.push(contentString(v))
  }
  const ed = parseElementor(payload?.meta?._elementor_data)
  if (ed && typeof ed === 'object') for (const w of widgetTexts(ed)) parts.push(w.text)
  for (const mk of ['_yoast_wpseo_title', '_yoast_wpseo_metadesc']) {
    const mv = payload?.meta?.[mk]
    if (typeof mv === 'string') parts.push(mv)
  }
  return parts.join('\n')
}

const countMatches = (str, rx) => (str.match(rx) || []).length
const stripTags = (s) => asString(s).replace(/<[^>]+>/g, ' ')

// `content` is either a string (our payload) or the REST object
// `{ rendered, raw }` (a live entity). Compare like with like, and use RAW
// ONLY: `.rendered` is the BUILT page for an Elementor post — the entire page,
// with its own images, headings, brand-mentioning filenames/alt text and inline
// JSON-LD — which is not what a body-level check is about and can never equal a
// raw payload body (2026-10-03: every correct Elementor edit failed
// image/heading parity, 0 <img> vs source 36).
//
// An absent `.raw` returns '' — "no authored body, nothing to compare" — so the
// body-level checks SKIP rather than silently comparing against the render
// again. That matters: `wpEntity()` fetches without `context=edit`, which omits
// `.raw`, so a `.rendered` fallback here would quietly restore the old
// behaviour for every caller that forgot the parameter (L-47).
function contentString(c) {
  if (c == null) return ''
  if (typeof c === 'string') return c
  if (typeof c === 'object') return String(c.raw ?? '')
  return String(c)
}

// ── the gate ──────────────────────────────────────────────────────────────
// A control-plane item can carry an entity in TWO shapes:
//   nested  { content, meta: { _elementor_data, _yoast_wpseo_title } }   ← the write payload / a real REST entity
//   flat    { content, 'meta._elementor_data': …, 'meta._yoast…': … }    ← the `before` snapshot (dotted keys)
//
// Only the nested shape has `meta._elementor_data`, so a flat entity used as the
// `source` used to (a) leave `parseElementor(source?.meta?._elementor_data)`
// empty — silently DISABLING the three `_elementor_data` guards
// (`widget_count`, `element_ids_preserved`, `length_anomaly`) — and (b) have its
// whole Elementor JSON pushed as source TEXT by `payloadText`, because the guard
// there skipped the key `meta` but not `meta._elementor_data`. Between them the
// OC's authoritative gate ran a reduced check set, blocked a correct edit, and
// reported `passed` as though it had fully validated (L-48).
//
// Folding the dotted keys into `meta` makes every check below shape-agnostic.
// Done here, in the validator, rather than in `seo-batch.js`'s `revalidate()`,
// so it also protects the Workbench's vendored copy and any future caller.
function normalizeEntity(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj
  const dotted = Object.keys(obj).filter(k => k.startsWith('meta.'))
  if (!dotted.length) return obj
  const out = { ...obj }
  const nested = obj.meta && typeof obj.meta === 'object' && !Array.isArray(obj.meta) ? obj.meta : {}
  const meta = { ...nested }
  for (const k of dotted) { meta[k.slice('meta.'.length)] = obj[k]; delete out[k] }
  out.meta = meta
  return out
}

// kind: 'post' | 'page' | 'product'   lang: 'en'|'es'|'zh-hant'|'ja'|'fr'
// payload: the exact WP write body    source: the EN-original object it derives from (optional but recommended)
//
// Returns { passed, checks, ran, skipped }.
//   checks[].ok === true   the check ran, clean
//   checks[].ok === false  the check ran and found a problem — OR could not run
//                          where running was mandatory (detail says which)
//   checks[].ok === null   the check did not run, and not running is acceptable
// `passed` fails only on an explicit `false`, so it is unchanged for every
// payload that passed before. `skipped` > 0 is what tells a caller its pass was
// PARTIAL — previously indistinguishable from a full one (L-48). A check never
// disappears without a reason in `checks`.
export function validatePayload({ kind, lang, endpoint = '', payload = {}, source = null } = {}) {
  const checks = []
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail })
  const skip = (name, detail) => add(name, null, detail)

  payload = normalizeEntity(payload) || {}
  source = normalizeEntity(source)

  const isTranslation = !!lang && lang !== 'en'
  const text = payloadText(payload)
  const srcText = source ? payloadText(source) : ''

  // A source fetched without `context=edit` has `content.rendered` but no
  // `content.raw` — no authored body to compare against (L-47). The body-level
  // checks below then SKIP with a reason rather than comparing against the
  // built page.
  const srcContent = source?.content
  const sourceBodyMissing = !!srcContent && typeof srcContent === 'object' && typeof srcContent.raw !== 'string'
  const NO_SOURCE = 'did not run — no source supplied; nothing to compare the payload against'

  // 1. Elementor JSON parses
  const edRaw = payload?.meta?._elementor_data
  const ed = parseElementor(edRaw)
  if (edRaw != null) add('json_parses', ed !== undefined, ed === undefined ? '_elementor_data does not JSON.parse' : '')

  // 2/3/4. structure vs source. A payload that WRITES `_elementor_data` is a
  // layout write, and these three are its B20 (stale copy) / B6 (hallucination
  // scale) protection — so "could not run" is a failure here, not an acceptable
  // skip: an unguarded layout write is exactly what these exist to stop.
  const srcEd = source ? parseElementor(source?.meta?._elementor_data) : null
  if (edRaw != null) {
    if (!(ed && typeof ed === 'object')) {
      const why = 'did not run — payload _elementor_data does not parse (see json_parses)'
      add('widget_count', false, why)
      add('element_ids_preserved', false, why)
      add('length_anomaly', false, why)
    } else if (!(srcEd && typeof srcEd === 'object')) {
      const why = source
        ? 'did not run — source has no _elementor_data; a layout write MUST carry the live EN entity as `source` (a flat `before` works once meta.* keys are present)'
        : 'did not run — a payload writing _elementor_data MUST carry `source` (the live EN entity) so the layout guards can run'
      add('widget_count', false, why)
      add('element_ids_preserved', false, why)
      add('length_anomaly', false, why)
    } else {
      const pw = [...walk(ed)].filter(isWidget).length
      const sw = [...walk(srcEd)].filter(isWidget).length
      add('widget_count', pw === sw, pw === sw ? '' : `payload ${pw} widgets vs source ${sw} (stale layout? B20)`)

      const pIds = elementIds(ed), sIds = elementIds(srcEd)
      const introduced = [...pIds].filter(id => !sIds.has(id))
      add('element_ids_preserved', introduced.length === 0,
        introduced.length ? `payload introduces ${introduced.length} element id(s) not in source: ${introduced.slice(0, 5).join(', ')}` : '')

      // length anomaly per widget vs the source widget of the same id
      const srcById = new Map()
      for (const w of widgetTexts(srcEd)) srcById.set(w.id + '|' + w.key, w.text)
      const anomalies = []
      for (const w of widgetTexts(ed)) {
        const s = srcById.get(w.id + '|' + w.key)
        if (s == null) continue
        const isEditor = w.key === 'editor' || w.key === 'description_text'
        const capChars = isEditor ? 2000 : 200
        const capRatio = isEditor ? 3 : 4
        if (w.text.length > capChars || (s.length > 0 && w.text.length > s.length * capRatio)) {
          anomalies.push(`${w.id}.${w.key}: ${s.length}→${w.text.length}`)
        }
      }
      add('length_anomaly', anomalies.length === 0,
        anomalies.length ? `hallucination-scale growth (B6): ${anomalies.slice(0, 4).join('; ')}` : '')
    }
  }

  // 5. wrong-language characters (run on DECODED text — B35e)
  if (isTranslation) {
    if (lang === 'es' || lang === 'fr') {
      // CJK that isn't also in the EN source (legit artifacts: IG embeds, filenames, zodiac-year chars)
      const bad = [...text].filter(ch => CJK_RX.test(ch) && !srcText.includes(ch))
      add('wrong_language_chars', bad.length === 0,
        bad.length ? `${bad.length} CJK char(s) in a ${lang} payload not present in source (B33/B35): ${[...new Set(bad)].slice(0, 8).join('')}` : '')
    } else if (lang === 'zh-hant') {
      const simp = new Set(SIMPLIFIED)
      const bad = [...text].filter(ch => simp.has(ch))
      add('wrong_language_chars', bad.length === 0,
        bad.length ? `simplified-Chinese form(s) in a zh-hant payload: ${[...new Set(bad)].slice(0, 12).join('')}` : '')
    } else if (lang === 'ja') {
      const simp = new Set(SIMPLIFIED_JA)
      const bad = [...text].filter(ch => simp.has(ch) && !srcText.includes(ch))
      add('wrong_language_chars', bad.length === 0,
        bad.length ? `simplified-Chinese form(s) in a ja payload: ${[...new Set(bad)].slice(0, 12).join('')}` : '')
    }
  }

  // 6. placeholder / apology / untranslated markers (B12); "por favor" only
  //    when it fronts a translator instruction (B51).
  const ph = text.match(PLACEHOLDER_RX) || text.match(SPANISH_INSTRUCTION_RX)
    || text.match(FRENCH_INSTRUCTION_RX) || text.match(JAPANESE_INSTRUCTION_RX)
    || text.match(TRADITIONAL_ZH_INSTRUCTION_RX)
  add('placeholder_markers', !ph, ph ? `contains "${ph[0]}"` : '')

  // 6b. Encoding damage. Scan the parsed Elementor value too: its raw JSON
  // may spell U+FFFD as "\\ufffd", which does not contain the character we
  // need to catch. Both halves of the surrogate-pair check matter: a malformed
  // string may contain an unpaired low surrogate as well as an unpaired high.
  const parsedElementor = edRaw != null && ed !== undefined ? JSON.stringify(ed) : ''
  const enc = [text, parsedElementor].join('\n')
  const damaged = /[\uFFFD]/.test(enc)
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(enc)
    || /Ã[\u0080-\u00BF]|â€|ï¿½/.test(enc)
  add('no_encoding_damage', !damaged,
    damaged ? 'U+FFFD / lone surrogate / legacy mojibake in the payload' : '')

  // 7. brand terms preserved (only meaningful when we have the source).
  //    Compare on markup-free text: <script>/<style> bodies (JSON-LD in
  //    particular embeds "Crystocraft") and tags would otherwise make a brand
  //    term look "present in source" that no human-visible copy dropped (B53).
  if (!source) {
    skip('brand_terms_preserved', NO_SOURCE)
  } else {
    const bare = (s) => stripTags(String(s).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' '))
    const srcBare = bare(srcText), payBare = bare(text)
    const dropped = BRAND_TERMS.filter(t => srcBare.includes(t) && !payBare.includes(t))
    add('brand_terms_preserved', dropped.length === 0,
      dropped.length ? `brand term(s) translated away: ${dropped.join(', ')}` : '')
  }

  // 8. SKU / model prefix preserved on the name
  if (!source) {
    skip('sku_prefix_preserved', NO_SOURCE)
  } else if (typeof payload.name === 'string' && typeof source.name === 'string') {
    const m = source.name.match(/^([A-Z0-9]{2,}(?:[-/][A-Z0-9]+)*)[\s–-]/)
    if (m) add('sku_prefix_preserved', payload.name.startsWith(m[1]),
      payload.name.startsWith(m[1]) ? '' : `name should start with SKU "${m[1]}" — got "${payload.name.slice(0, 40)}"`)
  }

  // 9/10. image + heading count parity (HTML fields). Both sides go through
  // contentString() so a live entity's REST `content` object is compared on its
  // RAW body, not its rendered page (see the helper).
  if (!source) {
    skip('image_count_parity', NO_SOURCE)
    skip('heading_count_parity', NO_SOURCE)
  } else if (sourceBodyMissing) {
    const why = 'did not run — source body has no .raw; fetch the entity with context=edit (L-47)'
    skip('image_count_parity', why)
    skip('heading_count_parity', why)
  } else {
    const pBody = contentString(payload.content) + contentString(payload.description) + contentString(payload.short_description)
    const sBody = contentString(source.content) + contentString(source.description) + contentString(source.short_description)
    const pImg = countMatches(pBody, /<img[\s>]/gi)
    const sImg = countMatches(sBody, /<img[\s>]/gi)
    if (sImg > 0) add('image_count_parity', pImg === sImg, pImg === sImg ? '' : `${pImg} <img> vs source ${sImg}`)

    const pHEad = contentString(payload.content) + contentString(payload.description)
    const sHead = contentString(source.content) + contentString(source.description)
    const pH = countMatches(pHEad, /<h2[\s>]/gi)
    const sH = countMatches(sHead, /<h2[\s>]/gi)
    if (sH > 0) add('heading_count_parity', pH === sH, pH === sH ? '' : `${pH} <h2> vs source ${sH}`)
  }

  // 11. no scripts/tables introduced. Same raw-body rule: a source entity's
  // `.rendered` page carries Yoast's inline JSON-LD <script>, which used to
  // suppress this check entirely; and it can equally carry a <table> the raw
  // body never had.
  const bodyStr = contentString(payload.content) + contentString(payload.description) + contentString(payload.short_description) + asString(edRaw)
  const srcBodyStr = source ? contentString(source.content) + contentString(source.description) + contentString(source.short_description) + asString(source?.meta?._elementor_data) : ''
  const scripts = (name, rx, what) => {
    if (source && sourceBodyMissing) return skip(name, 'did not run — source body has no .raw; fetch the entity with context=edit (L-47)')
    if (source && rx.test(srcBodyStr)) return skip(name, `did not run — source already contains ${what}; a pre-existing one cannot be attributed to this write`)
    add(name, !rx.test(bodyStr), rx.test(bodyStr) ? `${what} introduced` : '')
  }
  scripts('no_new_scripts', SCRIPT_RX, '<script>')
  scripts('no_new_tables', TABLE_RX, '<table>')

  // 12. Yoast title double-branding (L-09). A custom Yoast title is emitted
  // verbatim; only the post-title path receives Yoast's site-name template.
  // Still reject a literal duplicate in either field.
  const yt = payload?.meta?._yoast_wpseo_title
  const pt = typeof payload?.title === 'string' ? payload.title : ''
  const DBL_RX = /crystocraft\s*[|\-–—]\s*crystocraft/i
  const branded = (s) => /crystocraft\s*$/i.test(String(s).trim())
  const doubled = DBL_RX.test(yt || '') || DBL_RX.test(pt)
    || ((!yt || !yt.trim()) && branded(pt))
  if (yt || pt) {
    add('seo_title_no_double_brand', !doubled,
      doubled ? `site name would be doubled (L-09): custom title ${JSON.stringify(yt || '')}, post title ${JSON.stringify(pt)}` : '')
  }

  // 13. meta description length
  const yd = payload?.meta?._yoast_wpseo_metadesc
  if (typeof yd === 'string' && yd) add('seo_desc_length', yd.length <= 158, yd.length > 158 ? `${yd.length} chars (>158)` : '')

  // 14. an unlinked translation draft must NOT be published (Rule 4)
  if (isTranslation && /[?&]lang=/.test(endpoint) && /\/(posts|pages|products)(\?|$)/.test(endpoint)) {
    const pub = payload.status === 'publish' || payload.status === 'future'
    add('translation_draft_only', !pub, pub ? `creating a ${lang} translation with status:${payload.status} — must be draft until the trid is linked (Rule 4)` : '')
  }

  // 15. advisory — layout write needs a cache clear afterwards
  if (edRaw != null) add('elementor_cache_reminder', true, 'writes _elementor_data — element-cache clear + flush-css + host purge required after (Rule 5)')

  const passed = checks.every(c => c.ok !== false)
  // `ran` / `skipped` are what let a caller tell a FULL pass from a partial one
  // — the thing that was impossible before L-48. `skipped` counts only checks
  // that were applicable-but-could-not-run (or that a caller suppressed by not
  // supplying a source); a check that never applied is simply absent.
  const ran = checks.filter(c => c.ok === true || c.ok === false).length
  const skipped = checks.filter(c => c.ok == null).length
  return { passed, checks, ran, skipped }
}

export default validatePayload
