// Fixed desktop artwork keeps mobile emoji fonts from changing these icons.
const iconStyle = {
    height: '1.1em',
    width: 'auto',
    objectFit: 'contain',
    flexShrink: 0,
    verticalAlign: '-0.125em',
};

export function GoldCoinIcon() {
    return <img src="/assets/rewards/gold-coin.png" width="108" height="88"
        style={iconStyle} alt="" aria-hidden="true" />;
}

export function CashbackIcon() {
    return <img src="/assets/rewards/cashback-arrow.png" width="68" height="88"
        style={iconStyle} alt="" aria-hidden="true" />;
}
