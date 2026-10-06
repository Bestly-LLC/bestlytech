/**
 * Copy for /turo-key and /turo-lax in the languages our Turo guests use most.
 * The page picks the guest's phone language; English is always one tap away.
 * Keep every string short: nothing on this page may truncate.
 */
export type Lang = "en" | "es" | "fr" | "de" | "it" | "pt" | "ko" | "ja" | "zh" | "zh-Hant";

export type Copy = {
  name: string; // the language's own name, shown on the switch
  title: string;
  welcome: (first: string) => string;
  subHome: string;
  subLax: string;
  subBack: string;
  phone: string;
  country: string;
  last: string;
  lastHint: string;
  open: string;
  cont: string;
  notYou: string;
  note: string;
  errSlow: string;
  errMissing: string;
  errPhone: string;
  errNoMatch: string;
  errNet: string;
  opening: string;
};

export const COPY: Record<Lang, Copy> = {
  en: {
    name: "English",
    title: "Your trip page",
    welcome: (f) => (f ? `Welcome back, ${f}` : "Welcome back"),
    subHome: "Your Tesla key, the car's spot and climate controls all live here.",
    subLax: "Your Tesla key, garage pass, the car's spot and climate controls all live here.",
    subBack: "Pick up where you left off.",
    phone: "Phone number on your Turo account",
    country: "Country",
    last: "Last name",
    lastHint: "As it appears on Turo. First name works too.",
    open: "Open my trip",
    cont: "Continue",
    notYou: "Not you? Sign in again",
    note: "Your key appears once your license is checked and the car is ready. Upload your driver's license in the Turo app if you haven't yet.",
    errSlow: "Too many tries. Please wait 15 minutes, or message me in Turo chat.",
    errMissing: "Enter your phone number and last name.",
    errPhone: "That phone number looks incomplete. Check the country and the number.",
    errNoMatch: "We couldn't find a trip with that phone and name. Use the ones on your Turo account, or message me in Turo chat.",
    errNet: "Something went wrong. Check your connection and try again.",
    opening: "Opening your trip",
  },
  es: {
    name: "Español",
    title: "Tu viaje",
    welcome: (f) => (f ? `Hola de nuevo, ${f}` : "Hola de nuevo"),
    subHome: "Tu llave Tesla, dónde está el auto y el control del clima, todo aquí.",
    subLax: "Tu llave Tesla, el pase del estacionamiento, dónde está el auto y el clima, todo aquí.",
    subBack: "Sigue donde lo dejaste.",
    phone: "Teléfono de tu cuenta de Turo",
    country: "País",
    last: "Apellido",
    lastHint: "Como aparece en Turo. También sirve tu nombre.",
    open: "Abrir mi viaje",
    cont: "Continuar",
    notYou: "¿No eres tú? Inicia sesión de nuevo",
    note: "Tu llave aparece cuando se verifique tu licencia y el auto esté listo. Sube tu licencia en la app de Turo si aún no lo hiciste.",
    errSlow: "Demasiados intentos. Espera 15 minutos o escríbeme por el chat de Turo.",
    errMissing: "Escribe tu teléfono y tu apellido.",
    errPhone: "El número parece incompleto. Revisa el país y el número.",
    errNoMatch: "No encontramos un viaje con ese teléfono y nombre. Usa los de tu cuenta de Turo o escríbeme por el chat de Turo.",
    errNet: "Algo salió mal. Revisa tu conexión e inténtalo de nuevo.",
    opening: "Abriendo tu viaje",
  },
  fr: {
    name: "Français",
    title: "Votre voyage",
    welcome: (f) => (f ? `Bon retour, ${f}` : "Bon retour"),
    subHome: "Votre clé Tesla, l'emplacement de la voiture et la climatisation, tout est ici.",
    subLax: "Votre clé Tesla, le pass du parking, l'emplacement de la voiture et la climatisation, tout est ici.",
    subBack: "Reprenez là où vous en étiez.",
    phone: "Téléphone de votre compte Turo",
    country: "Pays",
    last: "Nom de famille",
    lastHint: "Comme sur Turo. Le prénom fonctionne aussi.",
    open: "Ouvrir mon voyage",
    cont: "Continuer",
    notYou: "Pas vous ? Reconnectez-vous",
    note: "Votre clé apparaît une fois votre permis vérifié et la voiture prête. Ajoutez votre permis dans l'app Turo si ce n'est pas fait.",
    errSlow: "Trop d'essais. Patientez 15 minutes ou écrivez-moi sur le chat Turo.",
    errMissing: "Entrez votre téléphone et votre nom.",
    errPhone: "Le numéro semble incomplet. Vérifiez le pays et le numéro.",
    errNoMatch: "Aucun voyage trouvé avec ce téléphone et ce nom. Utilisez ceux de votre compte Turo ou écrivez-moi sur le chat Turo.",
    errNet: "Un problème est survenu. Vérifiez votre connexion et réessayez.",
    opening: "Ouverture de votre voyage",
  },
  de: {
    name: "Deutsch",
    title: "Deine Reise",
    welcome: (f) => (f ? `Willkommen zurück, ${f}` : "Willkommen zurück"),
    subHome: "Dein Tesla-Schlüssel, der Standort des Autos und die Klimasteuerung, alles hier.",
    subLax: "Dein Tesla-Schlüssel, der Parkausweis, der Standort des Autos und die Klimasteuerung, alles hier.",
    subBack: "Mach dort weiter, wo du aufgehört hast.",
    phone: "Telefonnummer deines Turo-Kontos",
    country: "Land",
    last: "Nachname",
    lastHint: "Wie bei Turo. Der Vorname geht auch.",
    open: "Meine Reise öffnen",
    cont: "Weiter",
    notYou: "Nicht du? Neu anmelden",
    note: "Dein Schlüssel erscheint, sobald dein Führerschein geprüft und das Auto bereit ist. Lade deinen Führerschein in der Turo-App hoch, falls noch nicht geschehen.",
    errSlow: "Zu viele Versuche. Bitte warte 15 Minuten oder schreib mir im Turo-Chat.",
    errMissing: "Gib deine Telefonnummer und deinen Nachnamen ein.",
    errPhone: "Die Nummer scheint unvollständig. Prüfe Land und Nummer.",
    errNoMatch: "Keine Reise mit dieser Nummer und diesem Namen gefunden. Nutze die Angaben deines Turo-Kontos oder schreib mir im Turo-Chat.",
    errNet: "Etwas ist schiefgelaufen. Prüfe deine Verbindung und versuche es erneut.",
    opening: "Deine Reise wird geöffnet",
  },
  it: {
    name: "Italiano",
    title: "Il tuo viaggio",
    welcome: (f) => (f ? `Bentornato, ${f}` : "Bentornato"),
    subHome: "La tua chiave Tesla, dove si trova l'auto e il clima, tutto qui.",
    subLax: "La tua chiave Tesla, il pass del parcheggio, dove si trova l'auto e il clima, tutto qui.",
    subBack: "Riprendi da dove avevi lasciato.",
    phone: "Telefono del tuo account Turo",
    country: "Paese",
    last: "Cognome",
    lastHint: "Come appare su Turo. Va bene anche il nome.",
    open: "Apri il mio viaggio",
    cont: "Continua",
    notYou: "Non sei tu? Accedi di nuovo",
    note: "La chiave appare quando la patente è verificata e l'auto è pronta. Carica la patente nell'app Turo se non l'hai ancora fatto.",
    errSlow: "Troppi tentativi. Attendi 15 minuti o scrivimi nella chat di Turo.",
    errMissing: "Inserisci telefono e cognome.",
    errPhone: "Il numero sembra incompleto. Controlla paese e numero.",
    errNoMatch: "Nessun viaggio trovato con questo telefono e nome. Usa quelli del tuo account Turo o scrivimi nella chat di Turo.",
    errNet: "Qualcosa è andato storto. Controlla la connessione e riprova.",
    opening: "Apertura del viaggio",
  },
  pt: {
    name: "Português",
    title: "Sua viagem",
    welcome: (f) => (f ? `Bem-vindo de volta, ${f}` : "Bem-vindo de volta"),
    subHome: "Sua chave Tesla, onde está o carro e o controle do clima, tudo aqui.",
    subLax: "Sua chave Tesla, o passe do estacionamento, onde está o carro e o clima, tudo aqui.",
    subBack: "Continue de onde parou.",
    phone: "Telefone da sua conta Turo",
    country: "País",
    last: "Sobrenome",
    lastHint: "Como aparece no Turo. O primeiro nome também funciona.",
    open: "Abrir minha viagem",
    cont: "Continuar",
    notYou: "Não é você? Entre de novo",
    note: "Sua chave aparece quando sua carteira for verificada e o carro estiver pronto. Envie sua carteira no app Turo se ainda não enviou.",
    errSlow: "Muitas tentativas. Aguarde 15 minutos ou fale comigo no chat do Turo.",
    errMissing: "Digite seu telefone e sobrenome.",
    errPhone: "O número parece incompleto. Confira o país e o número.",
    errNoMatch: "Não encontramos uma viagem com esse telefone e nome. Use os da sua conta Turo ou fale comigo no chat do Turo.",
    errNet: "Algo deu errado. Verifique sua conexão e tente de novo.",
    opening: "Abrindo sua viagem",
  },
  ko: {
    name: "한국어",
    title: "내 여행 페이지",
    welcome: (f) => (f ? `${f}님, 다시 오신 것을 환영합니다` : "다시 오신 것을 환영합니다"),
    subHome: "테슬라 키, 차량 위치, 공조 조절이 모두 여기에 있습니다.",
    subLax: "테슬라 키, 주차장 출입증, 차량 위치, 공조 조절이 모두 여기에 있습니다.",
    subBack: "이어서 진행하세요.",
    phone: "Turo 계정의 전화번호",
    country: "국가",
    last: "성 (영문)",
    lastHint: "Turo에 등록된 영문 이름 그대로 입력하세요. 이름도 됩니다.",
    open: "내 여행 열기",
    cont: "계속",
    notYou: "본인이 아니신가요? 다시 로그인",
    note: "면허 확인이 끝나고 차량이 준비되면 키가 표시됩니다. 아직 안 하셨다면 Turo 앱에서 운전면허증을 올려 주세요.",
    errSlow: "시도 횟수가 너무 많습니다. 15분 후 다시 시도하시거나 Turo 채팅으로 연락 주세요.",
    errMissing: "전화번호와 성을 입력하세요.",
    errPhone: "전화번호가 완전하지 않은 것 같습니다. 국가와 번호를 확인하세요.",
    errNoMatch: "해당 전화번호와 이름으로 예약을 찾지 못했습니다. Turo 계정 정보를 입력하시거나 Turo 채팅으로 연락 주세요.",
    errNet: "문제가 발생했습니다. 연결을 확인하고 다시 시도하세요.",
    opening: "여행 페이지를 여는 중",
  },
  ja: {
    name: "日本語",
    title: "ご旅行のページ",
    welcome: (f) => (f ? `おかえりなさい、${f}さん` : "おかえりなさい"),
    subHome: "テスラのキー、車の場所、エアコン操作がすべてここにあります。",
    subLax: "テスラのキー、駐車場パス、車の場所、エアコン操作がすべてここにあります。",
    subBack: "続きから始められます。",
    phone: "Turoアカウントの電話番号",
    country: "国",
    last: "姓（ローマ字）",
    lastHint: "Turoに登録したとおりに入力してください。名でも大丈夫です。",
    open: "旅行を開く",
    cont: "続ける",
    notYou: "ご本人ではありませんか？ もう一度サインイン",
    note: "免許証の確認と車の準備が終わるとキーが表示されます。まだの方はTuroアプリで運転免許証をアップロードしてください。",
    errSlow: "試行回数が多すぎます。15分お待ちいただくか、Turoのチャットでご連絡ください。",
    errMissing: "電話番号と姓を入力してください。",
    errPhone: "電話番号が不完全なようです。国と番号をご確認ください。",
    errNoMatch: "その電話番号と名前で予約が見つかりませんでした。Turoアカウントの情報を使うか、Turoのチャットでご連絡ください。",
    errNet: "問題が発生しました。接続を確認して、もう一度お試しください。",
    opening: "旅行ページを開いています",
  },
  zh: {
    name: "简体中文",
    title: "您的行程页面",
    welcome: (f) => (f ? `欢迎回来，${f}` : "欢迎回来"),
    subHome: "特斯拉钥匙、车辆位置和空调控制都在这里。",
    subLax: "特斯拉钥匙、停车场通行证、车辆位置和空调控制都在这里。",
    subBack: "从上次离开的地方继续。",
    phone: "Turo 账户的手机号",
    country: "国家/地区",
    last: "姓（拼音）",
    lastHint: "请按 Turo 上的英文拼写填写。填名也可以。",
    open: "打开我的行程",
    cont: "继续",
    notYou: "不是您？重新登录",
    note: "驾照审核通过、车辆准备好后，钥匙会显示在这里。如果还没上传驾照，请在 Turo 应用中上传。",
    errSlow: "尝试次数过多。请等待 15 分钟，或在 Turo 聊天中联系我。",
    errMissing: "请输入手机号和姓氏。",
    errPhone: "手机号似乎不完整。请检查国家和号码。",
    errNoMatch: "未找到与该手机号和姓名匹配的行程。请使用 Turo 账户上的信息，或在 Turo 聊天中联系我。",
    errNet: "出了点问题。请检查网络后重试。",
    opening: "正在打开您的行程",
  },
  "zh-Hant": {
    name: "繁體中文",
    title: "您的行程頁面",
    welcome: (f) => (f ? `歡迎回來，${f}` : "歡迎回來"),
    subHome: "特斯拉鑰匙、車輛位置和空調控制都在這裡。",
    subLax: "特斯拉鑰匙、停車場通行證、車輛位置和空調控制都在這裡。",
    subBack: "從上次離開的地方繼續。",
    phone: "Turo 帳戶的手機號碼",
    country: "國家/地區",
    last: "姓（英文拼音）",
    lastHint: "請依 Turo 上的英文拼寫填寫。填名字也可以。",
    open: "打開我的行程",
    cont: "繼續",
    notYou: "不是您？重新登入",
    note: "駕照審核通過、車輛準備好後，鑰匙會顯示在這裡。如果還沒上傳駕照，請在 Turo App 中上傳。",
    errSlow: "嘗試次數過多。請等候 15 分鐘，或在 Turo 聊天中聯絡我。",
    errMissing: "請輸入手機號碼和姓氏。",
    errPhone: "手機號碼似乎不完整。請檢查國家和號碼。",
    errNoMatch: "找不到與該手機號碼和姓名相符的行程。請使用 Turo 帳戶上的資料，或在 Turo 聊天中聯絡我。",
    errNet: "發生問題。請檢查網路後再試一次。",
    opening: "正在打開您的行程",
  },
};

/** The guest's best language from the browser, falling back to English. */
export function pickLang(langs: readonly string[] = typeof navigator !== "undefined" ? navigator.languages || [navigator.language] : []): Lang {
  for (const raw of langs) {
    const l = (raw || "").toLowerCase();
    if (l.startsWith("zh")) return /hant|tw|hk|mo/.test(l) ? "zh-Hant" : "zh";
    const base = l.split("-")[0] as Lang;
    if (base in COPY) return base;
  }
  return "en";
}

/** Region from the browser locale (ko-KR -> KR), else a likely home country for the language. */
export function pickRegion(langs: readonly string[] = typeof navigator !== "undefined" ? navigator.languages || [navigator.language] : []): string | null {
  for (const raw of langs) {
    const m = /^[a-z]{2,3}(?:-[A-Za-z]{4})?-([A-Za-z]{2})$/.exec(raw || "");
    if (m) return m[1].toUpperCase();
  }
  const first = (langs[0] || "").toLowerCase().split("-")[0];
  const guess: Record<string, string> = { ko: "KR", ja: "JP", de: "DE", fr: "FR", it: "IT", pt: "BR", es: "MX", zh: "CN" };
  return guess[first] || null;
}
