
export type ColorInfo = {
    HEX: string;
    RGB: {
        R: number;
        G: number;
        B: number;
    };
    TAILWIND_CLASS: string;
}



export type AppRoute = {
    id: string;
    title: string;
    description?: string;
}

export type VoidFunction = ()=>void;

export type AuthMode = "signin"|"signup"|"forgot_password"|null|undefined;
export type PasswordStrength = {text:'very weak',score:0} | {text:'weak',score:1} | {text:'medium',score:2} | {text:'strong',score:3} | {text:'very strong',score:4};
export type TailwindWidth =
  | '3xs'
  | '2xs'
  | 'xs'
  | 'sm'
  | 'md'
  | 'lg'
  | 'xl'
  | '2xl'
  | '3xl'
  | '4xl'
  | '5xl'
  | '6xl'
  | '7xl';

  export type TableData = {
    id?: string;
    title?: string;
    columns: string[];
    rows: (string | number | boolean | null)[][];
    enableHorizontalHeader?: boolean; // if true, the first column will be considered horizontal header.
  }

  export type CheckboxSetOption = {
    value: string | number;
    label: string;
    id?: string;
    description?: string;
};


export type DropdownOption = { label: string; value: string|number; id:string; flag?: string };

export type ComboboxOption = DropdownOption&{
  description?: string;
};

export type AnyObject = Record<string, any>;

export type HexColor = `#${string}`;
export type RgbColor = `rgb(${number}, ${number}, ${number})`;
export type RgbaColor = `rgba(${number}, ${number}, ${number}, ${number})`;
export type HslColor = `hsl(${number}, ${number}%, ${number}%)`;
export type HslaColor = `hsla(${number}, ${number}%, ${number}%, ${number})`;

export type ColorString = HexColor | RgbColor | RgbaColor | HslColor | HslaColor;

export type CssNamedColor =
  | 'aliceblue' | 'antiquewhite' | 'aqua' | 'aquamarine' | 'azure'
  | 'beige' | 'bisque' | 'black' | 'blanchedalmond' | 'blue'
  | 'blueviolet' | 'brown' | 'burlywood' | 'cadetblue' | 'chartreuse'
  | 'chocolate' | 'coral' | 'cornflowerblue' | 'cornsilk' | 'crimson'
  | 'cyan' | 'darkblue' | 'darkcyan' | 'darkgoldenrod' | 'darkgray'
  | 'darkgreen' | 'darkgrey' | 'darkkhaki' | 'darkmagenta' | 'darkolivegreen'
  | 'darkorange' | 'darkorchid' | 'darkred' | 'darksalmon' | 'darkseagreen'
  | 'darkslateblue' | 'darkslategray' | 'darkslategrey' | 'darkturquoise' | 'darkviolet'
  | 'deeppink' | 'deepskyblue' | 'dimgray' | 'dimgrey' | 'dodgerblue'
  | 'firebrick' | 'floralwhite' | 'forestgreen' | 'fuchsia' | 'gainsboro'
  | 'ghostwhite' | 'gold' | 'goldenrod' | 'gray' | 'green'
  | 'greenyellow' | 'grey' | 'honeydew' | 'hotpink' | 'indianred'
  | 'indigo' | 'ivory' | 'khaki' | 'lavender' | 'lavenderblush'
  | 'lawngreen' | 'lemonchiffon' | 'lightblue' | 'lightcoral' | 'lightcyan'
  | 'lightgoldenrodyellow' | 'lightgray' | 'lightgreen' | 'lightgrey' | 'lightpink'
  | 'lightsalmon' | 'lightseagreen' | 'lightskyblue' | 'lightslategray' | 'lightslategrey'
  | 'lightsteelblue' | 'lightyellow' | 'lime' | 'limegreen' | 'linen'
  | 'magenta' | 'maroon' | 'mediumaquamarine' | 'mediumblue' | 'mediumorchid'
  | 'mediumpurple' | 'mediumseagreen' | 'mediumslateblue' | 'mediumspringgreen' | 'mediumturquoise'
  | 'mediumvioletred' | 'midnightblue' | 'mintcream' | 'mistyrose' | 'moccasin'
  | 'navajowhite' | 'navy' | 'oldlace' | 'olive' | 'olivedrab'
  | 'orange' | 'orangered' | 'orchid' | 'palegoldenrod' | 'palegreen'
  | 'paleturquoise' | 'palevioletred' | 'papayawhip' | 'peachpuff' | 'peru'
  | 'pink' | 'plum' | 'powderblue' | 'purple' | 'rebeccapurple'
  | 'red' | 'rosybrown' | 'royalblue' | 'saddlebrown' | 'salmon'
  | 'sandybrown' | 'seagreen' | 'seashell' | 'sienna' | 'silver'
  | 'skyblue' | 'slateblue' | 'slategray' | 'slategrey' | 'snow'
  | 'springgreen' | 'steelblue' | 'tan' | 'teal' | 'thistle'
  | 'tomato' | 'turquoise' | 'violet' | 'wheat' | 'white'
  | 'whitesmoke' | 'yellow' | 'yellowgreen';

export type StringLiteralJoin<T extends string[], Sep extends string = ''> =
T extends [infer F extends string, ...infer R extends string[]]
    ? R['length'] extends 0
        ? F
        : `${F}${Sep}${StringLiteralJoin<R, Sep>}`
    : '';
