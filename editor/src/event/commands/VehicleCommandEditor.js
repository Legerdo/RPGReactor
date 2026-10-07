/** Reactor vehicles use MZ plugin commands; stock vehicle opcodes retain their meaning. */
class VehicleCommandEditor {
    static LABELS = { GetOnVehicle: 'Get On Reactor Vehicle', GetOffVehicle: 'Get Off Reactor Vehicle' };
    static supports(name) { return Object.hasOwn(VehicleCommandEditor.LABELS, name); }
    static build(name, args, indent = 0) {
        return { code: 357, indent, parameters: ['RPGReactor', name, VehicleCommandEditor.LABELS[name], { ...args }] };
    }
    static summary(name, args = {}) { return name === 'GetOnVehicle' ? String(args.vehicle || 'this') : ''; }
    show(command, callback, hint) {
        const name = VehicleCommandEditor.supports(command?.parameters?.[1]) ? command.parameters[1] : hint;
        const args = command?.parameters?.[3] || {};
        const t = key => window.I18n ? window.I18n.t(key) : key;
        const e = rrEscapeHtml, modal = document.createElement('div');
        modal.className = 'rr-modal-overlay'; modal.style.zIndex = '21000';
        modal.innerHTML = `<div class="rr-modal" style="width:min(460px,90vw)"><div class="rr-modal-header"><div class="rr-modal-title">${e(t(name === 'GetOnVehicle' ? 'vehicle.getOn' : 'vehicle.getOff'))}</div><button class="rr-modal-close vc-cancel">&times;</button></div><div class="rr-modal-body" style="display:flex;flex-direction:column;gap:10px">
            ${name === 'GetOnVehicle' ? `<label>${e(t('vehicle.target'))}<input class="vc-target" value="${e(args.vehicle || 'this')}" style="width:100%;box-sizing:border-box"></label><p>${e(t('vehicle.targetHelp'))}</p>` : ''}
            <label><input class="vc-instant" type="checkbox" ${String(args.instant) === 'true' ? 'checked' : ''}> ${e(t('vehicle.instant'))}</label>
            <label><input class="vc-wait" type="checkbox" ${String(args.wait) !== 'false' ? 'checked' : ''}> ${e(t('vehicle.wait'))}</label>
            </div><div class="rr-modal-footer"><button class="rr-btn-secondary vc-cancel">${e(t('common.cancel'))}</button><button class="rr-button-primary vc-ok">${e(t('common.ok'))}</button></div></div>`;
        document.body.appendChild(modal);
        const close = () => { document.removeEventListener('keydown', onKey, true); modal.remove(); };
        const cancel = () => { close(); callback(null); };
        const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); } };
        document.addEventListener('keydown', onKey, true);
        modal.querySelectorAll('.vc-cancel').forEach(button => button.addEventListener('click', cancel));
        modal.querySelector('.vc-ok').addEventListener('click', () => {
            const built = { ...args, instant: String(modal.querySelector('.vc-instant').checked), wait: String(modal.querySelector('.vc-wait').checked) };
            if (name === 'GetOnVehicle') built.vehicle = modal.querySelector('.vc-target').value.trim() || 'this';
            close(); callback(VehicleCommandEditor.build(name, built, command?.indent || 0));
        });
        (modal.querySelector('.vc-target') || modal.querySelector('.vc-ok')).focus();
    }
}
if (typeof globalThis !== 'undefined') globalThis.VehicleCommandEditor = VehicleCommandEditor;
if (typeof module !== 'undefined' && module.exports) module.exports = VehicleCommandEditor;
