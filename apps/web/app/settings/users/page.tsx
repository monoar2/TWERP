"use client";
import { useState, type FormEvent } from "react";
import { canAccess, type Role, type UserRow } from "@erp/client";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { useProfile } from "@/components/Shell";
import { Card, Empty, ErrorBox, Field, Loading, Modal, Notice, PageHeader, useAction, useData } from "@/components/ui";

const MIN_PASSWORD = 10;

export default function UsersPage() {
  const profile = useProfile();
  const isAdmin = canAccess(profile, "users", true);
  const users = useData(() => (isAdmin ? api().users() : Promise.resolve([] as UserRow[])), [isAdmin]);
  const roles = useData(() => (isAdmin ? api().roles() : Promise.resolve([])), [isAdmin]);
  const roleLabel = (code: Role) => roles.data?.find((r) => r.code === code)?.label ?? code;

  const [form, setForm] = useState({ email: "", name: "", role: "consulta" as Role, password: "" });
  const [notice, setNotice] = useState("");
  const createAction = useAction();
  const rowAction = useAction();
  const [editing, setEditing] = useState<UserRow | null>(null);

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Usuarios" />
        <div className="alert alert-warning">Solo el administrador puede gestionar usuarios.</div>
      </>
    );
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setNotice("");
    if (form.password.length < MIN_PASSWORD) { createAction.setError(new Error(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`)); return; }
    const ok = await createAction.run(() => api().createUser({ ...form, email: form.email.trim(), name: form.name.trim() }));
    if (ok) {
      setNotice(`Usuario ${ok.email} creado. Compártele su contraseña inicial por un medio seguro.`);
      setForm({ email: "", name: "", role: form.role, password: "" });
      void users.reload();
    }
  }

  async function toggleActive(u: UserRow) {
    setNotice("");
    const ok = await rowAction.run(() => api().updateUser(u.id, { active: !u.active }));
    if (ok) { setNotice(`${ok.email} ${ok.active ? "activado" : "desactivado"}.`); void users.reload(); }
  }

  return (
    <>
      <PageHeader title="Usuarios" subtitle="Quién puede entrar al sistema y qué puede hacer cada rol." />
      <Card title="Usuarios">
        <Notice>{notice}</Notice>
        <ErrorBox error={rowAction.error ?? users.error ?? roles.error} />
        {users.loading && !users.data ? <Loading /> : (users.data ?? []).length === 0 ? <Empty>No hay usuarios.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Correo</th><th>Nombre</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th /></tr></thead>
              <tbody>
                {(users.data ?? []).map((u) => (
                  <tr key={u.id}>
                    <td className="mono small">{u.email}</td>
                    <td>{u.name}{u.id === profile?.user.id ? <span className="muted small"> (tú)</span> : null}</td>
                    <td>{roleLabel(u.role)}</td>
                    <td>{u.active ? <span className="chip chip-success">Activo</span> : <span className="chip chip-neutral">Inactivo</span>}</td>
                    <td className="small">{u.last_login_at ? dateTime(u.last_login_at) : <span className="muted">Nunca</span>}</td>
                    <td className="num">
                      <div className="actions" style={{ justifyContent: "flex-end" }}>
                        <button className="btn btn-sm" onClick={() => setEditing(u)}>Editar</button>
                        {u.id !== profile?.user.id ? (
                          <button className={`btn btn-sm ${u.active ? "btn-danger" : ""}`} disabled={rowAction.busy} onClick={() => toggleActive(u)}>
                            {u.active ? "Desactivar" : "Activar"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Nuevo usuario">
        <form onSubmit={create}>
          <div className="form-grid">
            <Field label="Correo electrónico"><input type="email" required autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Nombre"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Rol">
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {(roles.data ?? []).map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
            </Field>
            <Field label="Contraseña inicial" hint={`Mínimo ${MIN_PASSWORD} caracteres`}>
              <input type="text" required minLength={MIN_PASSWORD} autoComplete="new-password" className="mono" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
          </div>
          <ErrorBox error={createAction.error} />
          <div className="form-actions"><button className="btn btn-primary" disabled={createAction.busy}>Crear usuario</button></div>
        </form>
      </Card>

      <Card title="Roles">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Rol</th><th>Puede consultar</th><th>Puede modificar</th></tr></thead>
            <tbody>
              {(roles.data ?? []).map((r) => (
                <tr key={r.code}>
                  <td><strong>{r.label}</strong></td>
                  <td className="small">{r.permissions.read.map(areaLabel).join(", ")}</td>
                  <td className="small">{r.permissions.write.length ? r.permissions.write.map(areaLabel).join(", ") : <span className="muted">Nada</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {editing ? (
        <EditUser
          user={editing}
          roles={roles.data ?? []}
          isSelf={editing.id === profile?.user.id}
          onClose={() => setEditing(null)}
          onSaved={(u, msg) => { setEditing(null); setNotice(msg ?? `Usuario ${u.email} actualizado.`); void users.reload(); }}
        />
      ) : null}
    </>
  );
}

const AREA_LABELS: Record<string, string> = {
  accounting: "Contabilidad", sales: "Ventas", purchases: "Compras", parties: "Terceros", inventory: "Inventario",
  products: "Productos", banks: "Bancos", company: "Empresa", users: "Usuarios", ai: "IA", common: "General",
};
const areaLabel = (a: string) => AREA_LABELS[a] ?? a;

function EditUser({ user, roles, isSelf, onClose, onSaved }: {
  user: UserRow;
  roles: Array<{ code: Role; label: string }>;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (u: UserRow, msg?: string) => void;
}) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<Role>(user.role);
  const [password, setPassword] = useState("");
  const action = useAction();

  async function save(e: FormEvent) {
    e.preventDefault();
    if (password && password.length < MIN_PASSWORD) { action.setError(new Error(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`)); return; }
    const body: { name?: string; role?: Role; password?: string } = {};
    if (name.trim() !== user.name) body.name = name.trim();
    if (role !== user.role) body.role = role;
    if (password) body.password = password;
    if (!Object.keys(body).length) { onClose(); return; }
    const ok = await action.run(() => api().updateUser(user.id, body));
    if (ok) onSaved(ok, password ? `Usuario ${ok.email} actualizado; contraseña restablecida.` : undefined);
  }

  return (
    <Modal title={`Editar ${user.email}`} open onClose={onClose}>
      <form onSubmit={save}>
        <div className="form-grid">
          <Field label="Nombre"><input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Rol" hint={isSelf ? "No puedes quitarte el rol de administrador" : undefined}>
            <select value={role} disabled={isSelf} onChange={(e) => setRole(e.target.value as Role)}>
              {roles.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="Restablecer contraseña" hint={`Opcional; mínimo ${MIN_PASSWORD} caracteres`} wide>
            <input type="text" className="mono" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Dejar vacío para no cambiarla" />
          </Field>
        </div>
        <ErrorBox error={action.error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={action.busy}>Guardar</button>
        </div>
      </form>
    </Modal>
  );
}
