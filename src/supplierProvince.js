// Best-effort guess of a supplier's SUPPLIER_PROVINCES value from its free-text
// city / address / Chinese name, for the one-time backfill on the Suppliers
// page. Heuristic on purpose — the backfill UI shows every guess for a human
// to confirm or override before anything is written.
import { SUPPLIER_PROVINCES } from './constants'

// city / prefecture / well-known manufacturing town  ->  province label.
// Keys are lower-cased; matched as a substring of the supplier's city+address
// (so "Shenzhen, Guangdong" or "深圳市宝安区" both hit). Chinese and pinyin
// keys both listed because the team's data mixes them.
const CITY_TO_PROVINCE = {
  // 广东 Guangdong
  'shenzhen': '广东 Guangdong', '深圳': '广东 Guangdong',
  'guangzhou': '广东 Guangdong', '广州': '广东 Guangdong',
  'dongguan': '广东 Guangdong', '东莞': '广东 Guangdong',
  'foshan': '广东 Guangdong', '佛山': '广东 Guangdong',
  'zhongshan': '广东 Guangdong', '中山': '广东 Guangdong',
  'huizhou': '广东 Guangdong', '惠州': '广东 Guangdong',
  'zhuhai': '广东 Guangdong', '珠海': '广东 Guangdong',
  'shantou': '广东 Guangdong', '汕头': '广东 Guangdong',
  'jiangmen': '广东 Guangdong', '江门': '广东 Guangdong',
  'chaozhou': '广东 Guangdong', '潮州': '广东 Guangdong',
  'jieyang': '广东 Guangdong', '揭阳': '广东 Guangdong',
  'guangdong': '广东 Guangdong', 'canton': '广东 Guangdong',
  // 浙江 Zhejiang
  'yiwu': '浙江 Zhejiang', '义乌': '浙江 Zhejiang',
  'hangzhou': '浙江 Zhejiang', '杭州': '浙江 Zhejiang',
  'ningbo': '浙江 Zhejiang', '宁波': '浙江 Zhejiang',
  'wenzhou': '浙江 Zhejiang', '温州': '浙江 Zhejiang',
  'pujiang': '浙江 Zhejiang', '浦江': '浙江 Zhejiang',
  'jinhua': '浙江 Zhejiang', '金华': '浙江 Zhejiang',
  'taizhou zhejiang': '浙江 Zhejiang', '台州': '浙江 Zhejiang',
  'shaoxing': '浙江 Zhejiang', '绍兴': '浙江 Zhejiang',
  'jiaxing': '浙江 Zhejiang', '嘉兴': '浙江 Zhejiang',
  'huzhou': '浙江 Zhejiang', '湖州': '浙江 Zhejiang',
  'quzhou': '浙江 Zhejiang', '衢州': '浙江 Zhejiang',
  'zhejiang': '浙江 Zhejiang',
  // 江苏 Jiangsu
  'suzhou': '江苏 Jiangsu', '苏州': '江苏 Jiangsu',
  'nanjing': '江苏 Jiangsu', '南京': '江苏 Jiangsu',
  'wuxi': '江苏 Jiangsu', '无锡': '江苏 Jiangsu',
  'changzhou': '江苏 Jiangsu', '常州': '江苏 Jiangsu',
  'yangzhou': '江苏 Jiangsu', '扬州': '江苏 Jiangsu',
  'nantong': '江苏 Jiangsu', '南通': '江苏 Jiangsu',
  'xuzhou': '江苏 Jiangsu', '徐州': '江苏 Jiangsu',
  'kunshan': '江苏 Jiangsu', '昆山': '江苏 Jiangsu',
  'jiangsu': '江苏 Jiangsu',
  // 福建 Fujian
  'xiamen': '福建 Fujian', '厦门': '福建 Fujian',
  'quanzhou': '福建 Fujian', '泉州': '福建 Fujian',
  'fuzhou': '福建 Fujian', '福州': '福建 Fujian',
  'putian': '福建 Fujian', '莆田': '福建 Fujian',
  'jinjiang': '福建 Fujian', '晋江': '福建 Fujian',
  'fujian': '福建 Fujian',
  // 上海 / 北京 / 天津 / 重庆
  'shanghai': '上海 Shanghai', '上海': '上海 Shanghai',
  'beijing': '北京 Beijing', '北京': '北京 Beijing', 'peking': '北京 Beijing',
  'tianjin': '天津 Tianjin', '天津': '天津 Tianjin',
  'chongqing': '重庆 Chongqing', '重庆': '重庆 Chongqing',
  // 山东 Shandong
  'qingdao': '山东 Shandong', '青岛': '山东 Shandong',
  'jinan': '山东 Shandong', '济南': '山东 Shandong',
  'weifang': '山东 Shandong', '潍坊': '山东 Shandong',
  'yantai': '山东 Shandong', '烟台': '山东 Shandong',
  'linyi': '山东 Shandong', '临沂': '山东 Shandong',
  'zibo': '山东 Shandong', '淄博': '山东 Shandong',
  'shandong': '山东 Shandong',
  // 河北 Hebei
  'shijiazhuang': '河北 Hebei', '石家庄': '河北 Hebei',
  'baoding': '河北 Hebei', '保定': '河北 Hebei',
  'baigou': '河北 Hebei', '白沟': '河北 Hebei',
  'tangshan': '河北 Hebei', '唐山': '河北 Hebei',
  'hebei': '河北 Hebei',
  // 河南 / 湖北 / 湖南 / 江西 / 安徽
  'zhengzhou': '河南 Henan', '郑州': '河南 Henan', 'henan': '河南 Henan',
  'wuhan': '湖北 Hubei', '武汉': '湖北 Hubei', 'hubei': '湖北 Hubei',
  'changsha': '湖南 Hunan', '长沙': '湖南 Hunan', 'hunan': '湖南 Hunan',
  'nanchang': '江西 Jiangxi', '南昌': '江西 Jiangxi', 'jiangxi': '江西 Jiangxi',
  'hefei': '安徽 Anhui', '合肥': '安徽 Anhui', 'anhui': '安徽 Anhui',
  // 广西 / 四川 / 云南 / 贵州
  'nanning': '广西 Guangxi', '南宁': '广西 Guangxi',
  'beihai': '广西 Guangxi', '北海': '广西 Guangxi', 'guangxi': '广西 Guangxi',
  'chengdu': '四川 Sichuan', '成都': '四川 Sichuan', 'sichuan': '四川 Sichuan',
  'kunming': '云南 Yunnan', '昆明': '云南 Yunnan', 'yunnan': '云南 Yunnan',
  'guiyang': '贵州 Guizhou', '贵阳': '贵州 Guizhou', 'guizhou': '贵州 Guizhou',
  // 辽宁 / 吉林 / 黑龙江 / 陕西 / 山西 / 甘肃 / 海南
  'shenyang': '辽宁 Liaoning', '沈阳': '辽宁 Liaoning',
  'dalian': '辽宁 Liaoning', '大连': '辽宁 Liaoning', 'liaoning': '辽宁 Liaoning',
  'changchun': '吉林 Jilin', '长春': '吉林 Jilin', 'jilin': '吉林 Jilin',
  'harbin': '黑龙江 Heilongjiang', '哈尔滨': '黑龙江 Heilongjiang', 'heilongjiang': '黑龙江 Heilongjiang',
  'xian': '陕西 Shaanxi', "xi'an": '陕西 Shaanxi', '西安': '陕西 Shaanxi', 'shaanxi': '陕西 Shaanxi',
  'taiyuan': '山西 Shanxi', '太原': '山西 Shanxi', 'shanxi': '山西 Shanxi',
  'lanzhou': '甘肃 Gansu', '兰州': '甘肃 Gansu', 'gansu': '甘肃 Gansu',
  'haikou': '海南 Hainan', '海口': '海南 Hainan', 'hainan': '海南 Hainan',
  // outside mainland
  'hong kong': '香港 Hong Kong', 'hongkong': '香港 Hong Kong', '香港': '香港 Hong Kong', 'hk': '香港 Hong Kong',
  'macau': '澳门 Macau', 'macao': '澳门 Macau', '澳门': '澳门 Macau',
  'taiwan': '台湾 Taiwan', '台湾': '台湾 Taiwan', 'taipei': '台湾 Taiwan', '台北': '台湾 Taiwan',
}

// Non-China country names -> "Outside China".
const NON_CHINA = /vietnam|india|thailand|indonesia|malaysia|korea|japan|turkey|pakistan|bangladesh|italy|germany|usa|united states|u\.s|america|cambodia|philippines|myanmar/i

// Returns a SUPPLIER_PROVINCES value, or '' if nothing matched confidently.
export function guessProvince(supplier) {
  const hay = [supplier.city, supplier.province, supplier.address, supplier.name_cn, supplier.name, supplier.country]
    .filter(Boolean).join(' ').toLowerCase()
  if (!hay.trim()) return ''

  // 1) someone typed the Chinese province/region name itself ("广东", "浙江省")
  for (const p of SUPPLIER_PROVINCES) {
    const zh = p.split(' ')[0]
    if (/[一-鿿]/.test(zh) && hay.includes(zh)) return p
  }
  // 2) city / town / pinyin-province lookup — longest key first so "台州"
  //    beats a stray "州" and "guangdong" beats "guang"
  for (const key of Object.keys(CITY_TO_PROVINCE).sort((a, b) => b.length - a.length)) {
    if (hay.includes(key)) return CITY_TO_PROVINCE[key]
  }
  // 3) explicitly a non-China country
  const country = (supplier.country || '').toLowerCase()
  if ((country && country !== 'china' && country !== '中国') || NON_CHINA.test(hay)) return 'Outside China'

  return ''
}
