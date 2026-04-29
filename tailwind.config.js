/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)',
  			// CR design-system radii. Prefer these in new code.
  			'cr-sm':   'var(--cr-radius-sm)',
  			'cr-md':   'var(--cr-radius-md)',
  			'cr-lg':   'var(--cr-radius-lg)',
  			'cr-xl':   'var(--cr-radius-xl)',
  			'cr-2xl':  'var(--cr-radius-2xl)',
  			'cr-full': 'var(--cr-radius-full)',
  		},
  		boxShadow: {
  			'cr-xs':       'var(--cr-shadow-xs)',
  			'cr-sm':       'var(--cr-shadow-sm)',
  			'cr-md':       'var(--cr-shadow-md)',
  			'cr-lg':       'var(--cr-shadow-lg)',
  			'cr-card':     'var(--cr-shadow-card)',
  			'cr-floating': 'var(--cr-shadow-floating)',
  		},
  		fontSize: {
  			'cr-xs':   ['var(--cr-font-size-xs)',   { lineHeight: 'var(--cr-line-height-normal)' }],
  			'cr-sm':   ['var(--cr-font-size-sm)',   { lineHeight: 'var(--cr-line-height-normal)' }],
  			'cr-base': ['var(--cr-font-size-base)', { lineHeight: 'var(--cr-line-height-normal)' }],
  			'cr-lg':   ['var(--cr-font-size-lg)',   { lineHeight: 'var(--cr-line-height-tight)'  }],
  			'cr-xl':   ['var(--cr-font-size-xl)',   { lineHeight: 'var(--cr-line-height-tight)'  }],
  			'cr-2xl':  ['var(--cr-font-size-2xl)',  { lineHeight: 'var(--cr-line-height-tight)'  }],
  		},
  		fontWeight: {
  			'cr-regular':  '400',
  			'cr-medium':   '500',
  			'cr-semibold': '600',
  			'cr-bold':     '700',
  		},
  		colors: {
  			// CarReminder design tokens (sprint 1).
  			// Use these in NEW code: bg-cr-surface-card, text-cr-text-primary,
  			// border-cr-border-default, ring-cr-border-focus-ring etc.
  			// The legacy hsl(var(--background)) bindings below stay so shadcn
  			// primitives (Button, Dialog, Select) keep working unchanged.
  			cr: {
  				brand: {
  					primary:       'var(--cr-brand-primary)',
  					'primary-hover': 'var(--cr-brand-primary-hover)',
  					'primary-soft': 'var(--cr-brand-primary-soft)',
  					accent:        'var(--cr-brand-accent)',
  					'accent-hover': 'var(--cr-brand-accent-hover)',
  				},
  				text: {
  					primary:       'var(--cr-text-primary)',
  					secondary:     'var(--cr-text-secondary)',
  					muted:         'var(--cr-text-muted)',
  					disabled:      'var(--cr-text-disabled)',
  					'on-brand':    'var(--cr-text-on-brand)',
  					link:          'var(--cr-text-link)',
  				},
  				surface: {
  					canvas:        'var(--cr-surface-canvas)',
  					subtle:        'var(--cr-surface-subtle)',
  					card:          'var(--cr-surface-card)',
  					elevated:      'var(--cr-surface-elevated)',
  					'brand-soft':  'var(--cr-surface-brand-soft)',
  					input:         'var(--cr-surface-input)',
  				},
  				border: {
  					subtle:        'var(--cr-border-subtle)',
  					DEFAULT:       'var(--cr-border-default)',
  					strong:        'var(--cr-border-strong)',
  					brand:         'var(--cr-border-brand)',
  					'focus-ring':  'var(--cr-border-focus-ring)',
  				},
  				status: {
  					'ok-bg':       'var(--cr-status-ok-bg)',
  					'ok-fg':       'var(--cr-status-ok-fg)',
  					'ok-border':   'var(--cr-status-ok-border)',
  					'ok-solid':    'var(--cr-status-ok-solid)',
  					'warn-bg':     'var(--cr-status-warn-bg)',
  					'warn-fg':     'var(--cr-status-warn-fg)',
  					'warn-border': 'var(--cr-status-warn-border)',
  					'warn-solid':  'var(--cr-status-warn-solid)',
  					'danger-bg':   'var(--cr-status-danger-bg)',
  					'danger-fg':   'var(--cr-status-danger-fg)',
  					'danger-border': 'var(--cr-status-danger-border)',
  					'danger-solid': 'var(--cr-status-danger-solid)',
  					'info-bg':     'var(--cr-status-info-bg)',
  					'info-fg':     'var(--cr-status-info-fg)',
  					'info-border': 'var(--cr-status-info-border)',
  					'info-solid':  'var(--cr-status-info-solid)',
  				},
  			},
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}