// What a replay was played on: the browser (its engine and version), the operating system, the processor and the
// display. A replay records it (`environment`) beside its build, so a replay that comes out differently somewhere else
// says whether the place changed (another browser engine, another processor) or the code did.

// Browser engines by the brand or token that names them, most specific first.
const ENGINES = [ [ /Edg|Chrom|Opera|OPR|Brave|Vivaldi|Samsung/, 'Blink' ], [ /Firefox|FxiOS/, 'Gecko' ], [ /Safari|AppleWebKit/, 'WebKit' ] ];

// The browser's name and version from its user-agent string, for the browsers that give nothing better.
function fromUserAgent( ua ) {

	const tests = [ [ 'Edge', /Edg\/([\d.]+)/ ], [ 'Opera', /OPR\/([\d.]+)/ ], [ 'Firefox', /Firefox\/([\d.]+)/ ], [ 'Chrome', /Chrome\/([\d.]+)/ ], [ 'Safari', /Version\/([\d.]+).*Safari/ ] ];
	for ( const [ name, pattern ] of tests ) {

		const match = ua.match( pattern );
		if ( match ) return { name, version: match[ 1 ] };

	}

	return { name: 'unknown', version: '' };

}

function osFromUserAgent( ua ) {

	const tests = [
		[ 'iOS', /(?:iPhone|iPad).*OS ([\d_]+)/ ], [ 'macOS', /Mac OS X ([\d_.]+)/ ], [ 'Windows', /Windows NT ([\d.]+)/ ],
		[ 'Android', /Android ([\d.]+)/ ], [ 'ChromeOS', /CrOS \S+ ([\d.]+)/ ], [ 'Linux', /Linux()/ ],
	];
	for ( const [ name, pattern ] of tests ) {

		const match = ua.match( pattern );
		if ( match ) return { name, version: ( match[ 1 ] ?? '' ).replace( /_/g, '.' ) };

	}

	return { name: 'unknown', version: '' };

}

/**
 * @returns {Promise<object>} `{ browser: { engine, name, version }, os: { name, version, arch }, display: { dpr }, ua }`
 */
async function environment() {

	const ua = navigator.userAgent;
	let browser = fromUserAgent( ua ), os = osFromUserAgent( ua ), arch = '';

	// Chromium's client hints give the exact version, the platform's own version and the processor; others give none.
	try {

		const hints = await navigator.userAgentData?.getHighEntropyValues( [ 'architecture', 'bitness', 'fullVersionList', 'platformVersion' ] );
		if ( hints ) {

			// A named browser before Chromium itself; never the placeholder brand Chromium lists to keep sniffers honest.
			const brands = ( hints.fullVersionList ?? [] ).filter( ( b ) => ! /Not.?A.?Brand/i.test( b.brand ) );
			const brand = brands.find( ( b ) => b.brand !== 'Chromium' ) ?? brands[ 0 ];
			if ( brand ) browser = { name: brand.brand, version: brand.version };
			if ( hints.platform ) os = { name: hints.platform, version: hints.platformVersion ?? os.version };
			arch = [ hints.architecture, hints.bitness ].filter( Boolean ).join( '-' );

		}

	} catch {}

	const engine = ENGINES.find( ( [ pattern ] ) => pattern.test( ua ) )?.[ 1 ] ?? 'unknown';

	return {
		browser: { engine, ...browser },
		os: { ...os, arch },
		display: { dpr: devicePixelRatio },
		ua,
	};

}

/** One line for people: "Chrome 141 (Blink) on macOS 15.6, arm-64". */
function describeEnvironment( env ) {

	if ( ! env ) return 'not recorded';
	const { browser, os } = env;
	return `${browser.name} ${browser.version} (${browser.engine}) on ${os.name} ${os.version}${os.arch ? `, ${os.arch}` : ''}`.replace( /\s+/g, ' ' ).trim();

}

export { environment, describeEnvironment };
