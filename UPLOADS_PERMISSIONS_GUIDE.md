# Guía de Configuración y Permisos de Carpeta para Subida de Archivos

Esta guía explica en detalle cómo configurar los permisos de carpetas y servidores (PHP / Node.js / Linux / Firebase Storage) para evitar bloqueos e hiper-cargas indefinidas durante la subida de imágenes y flyers.

---

## 1. Servidores Web Tradicionales (Linux / Apache / Nginx / PHP / Node.js)

Si las imágenes se guardan en una carpeta física dentro del servidor (por ejemplo, `./uploads/` o `./public/flyers/`):

### Permisos de Carpeta recomendados (CHMOD)

- **Permiso Estándar Seguro: `CHMOD 755`**
  - Otorga permisos de **Lectura, Escritura y Ejecución** al propietario del proceso web (ej. `www-data`, `nginx` o el usuario de Node.js).
  - Otorga permisos de **Lectura y Ejecución** al grupo y otros usuarios.
  
  ```bash
  # Asignar propietario del servidor web a la carpeta de uploads
  sudo chown -R www-data:www-data /var/www/html/uploads/

  # Aplicar directorio 755
  chmod 755 /var/www/html/uploads/
  ```

- **Permiso Temporal de Pruebas: `CHMOD 777`**
  - Otorga lectura, escritura y ejecución a **todos** los usuarios.
  - *Úsalo únicamente para verificar si el problema es de permisos*. En producción se recomienda retornar a `755` con el propietario correcto (`chown`).

  ```bash
  chmod 777 /var/www/html/uploads/
  ```

---

## 2. Configuración del Formulario y Encabezados (Frontend)

Para que el backend pueda recibir archivos binarios correctamente, la petición debe enviar el encabezado `multipart/form-data`:

### En HTML puro:
```html
<form action="/api/upload-flyer" method="POST" enctype="multipart/form-data">
    <input type="file" name="flyer" accept="image/jpeg,image/png,image/webp" />
    <button type="submit">Subir Flyer</button>
</form>
```

### En JavaScript (Fetch API / Axios):
```javascript
const formData = new FormData();
formData.append('flyer', fileInput.files[0]);
formData.append('title', 'Novedades SID Pesaje');

// NOTA: Con Fetch y FormData NO agregues 'Content-Type' manualmente, 
// el navegador lo calcula automáticamente junto con el 'boundary'.
const response = await fetch('/api/upload-flyer', {
    method: 'POST',
    body: formData
});
const data = await response.json();
```

---

## 3. Respuestas Claras del Backend (HTTP Status Codes)

El backend **SIEMPRE debe devolver una respuesta JSON** con un código de estado HTTP adecuado para evitar que el frontend se quede cargando indefinidamente:

- **Status 200 OK**: Subida exitosa.
  ```json
  { "success": true, "url": "/uploads/flyers/latest.jpg", "message": "Imagen subida correctamente" }
  ```
- **Status 400 Bad Request**: Validación fallida (tamaño o formato incorrecto).
  ```json
  { "success": false, "error": "El archivo supera el límite máximo de 8 MB." }
  ```
- **Status 500 Internal Server Error**: Error de permisos o servidor.
  ```json
  { "success": false, "error": "No hay permisos de escritura en la carpeta de destino." }
  ```

---

## 4. Reglas de Seguridad en Firebase Storage

Si usas **Firebase Storage** (como en este proyecto), la validación de permisos se maneja en el archivo `storage.rules`:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Reglas para la carpeta public-flyers
    match /public-flyers/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null; // Requiere estar autenticado como usuario/admin
    }
  }
}
```

---

## 5. Configuración de Límites en PHP (`php.ini`)

Si utilizas un servidor backend en PHP, asegúrate de que `php.ini` permita subir imágenes de hasta 8 MB:

```ini
upload_max_filesize = 8M
post_max_size = 10M
memory_limit = 128M
max_execution_time = 60
```
