# lambda_function.py
import json, os, boto3, mimetypes, base64
import time, re

S3_BUCKET = os.environ.get('BUCKET')
REGION = os.environ.get('AWS_REGION', 'us-east-1')
s3 = boto3.client('s3', region_name=REGION)


sns = boto3.client('sns', region_name=REGION)
SNS_TOPIC_ARN = os.environ.get('SNS_TOPIC_ARN')

def _valid_email(addr):
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", addr or ""))

def _clean_phone(s):
    s = (s or '').strip()
    # keep digits, +, spaces, dashes, parentheses; truncate to 30 chars
    s = re.sub(r"[^0-9+\-\s()]", "", s)[:30]
    return s

def s3_read_json(key, default):
    try:
        obj = s3.get_object(Bucket=S3_BUCKET, Key=key)
        return json.loads(obj['Body'].read().decode('utf-8'))
    except s3.exceptions.NoSuchKey:
        return default
    except s3.exceptions.ClientError as e:
        if e.response['Error']['Code'] == 'NoSuchKey':
            return default
        raise

def s3_write_json(key, data, cache_control='no-cache'):
    s3.put_object(
        Bucket=S3_BUCKET,
        Key=key,
        Body=json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8'),
        ContentType='application/json; charset=utf-8',
        CacheControl=cache_control
    )

def _resp(code, body, extra_headers=None):
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'content-type,authorization',
        'Access-Control-Allow-Methods': 'OPTIONS,POST'
    }
    if extra_headers:
        headers.update(extra_headers)
    return {'statusCode': code, 'headers': headers,
            'body': json.dumps(body, ensure_ascii=False)}

def _get_method_and_path(event):
    """
    Supports:
      - REST API / Lambda proxy: event['httpMethod'], event['path']
      - HTTP API v2: event['requestContext']['http']['method'], event['rawPath']
    """
    # HTTP API v2
    rc = event.get('requestContext') or {}
    http = rc.get('http') or {}
    if http:
        method = http.get('method', 'GET')
        path = (event.get('rawPath') or '').rstrip('/') or '/'
        return method, path
    # REST API
    method = event.get('httpMethod', 'GET')
    path = (event.get('path') or '').rstrip('/') or '/'
    return method, path

def _get_json_body(event):
    body = event.get('body')
    if not body:
        return {}
    if event.get('isBase64Encoded'):
        body = base64.b64decode(body).decode('utf-8')
    try:
        return json.loads(body)
    except Exception:
        return {}

def lambda_handler(event, context):
    method, path = _get_method_and_path(event)

    # CORS preflight
    if method == 'OPTIONS':
        return _resp(200, {'ok': True})

			 
						 
    body = _get_json_body(event)

    if path.endswith('/upload-url') and method == 'POST':
        key = body['key']
        ctype = body.get('contentType') or mimetypes.guess_type(key)[0] or 'application/octet-stream'
        url = s3.generate_presigned_url(
            'put_object',
            Params={'Bucket': S3_BUCKET, 'Key': key, 'ContentType': ctype},
            ExpiresIn=900
        )
        return _resp(200, {'url': url, 'method': 'PUT'})

    if path.endswith('/save-recipe') and method == 'POST':
        recipe = body['recipeJson']
        idx_patch = body['indexPatch']
        rid = recipe['id']
        s3_write_json(f'data/recipes/{rid}.json', recipe)
        index = s3_read_json('data/recipes/index.json', [])
        for i, item in enumerate(index):
            if item.get('id') == rid:
                index[i] = idx_patch
                break
        else:
            index.append(idx_patch)
        s3_write_json('data/recipes/index.json', index)
        return _resp(200, {'ok': True, 'id': rid})

    if path.endswith('/delete-recipe') and method == 'POST':
        rid = body['id']
        delete_images = bool(body.get('deleteImages'))
        s3.delete_object(Bucket=S3_BUCKET, Key=f'data/recipes/{rid}.json')
        index = s3_read_json('data/recipes/index.json', [])
        index = [x for x in index if x.get('id') != rid]
        s3_write_json('data/recipes/index.json', index)
        if delete_images:
            # delete all under images/recipes/<rid>/
            paginator = s3.get_paginator('list_objects_v2')
            to_delete = []
            for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=f'images/recipes/{rid}/'):
                for obj in page.get('Contents', []):
                    to_delete.append({'Key': obj['Key']})
                    if len(to_delete) == 1000:
                        s3.delete_objects(Bucket=S3_BUCKET, Delete={'Objects': to_delete})
                        to_delete = []
            if to_delete:
                s3.delete_objects(Bucket=S3_BUCKET, Delete={'Objects': to_delete})
        return _resp(200, {'ok': True, 'id': rid})

    if path.endswith('/delete-object') and method == 'POST':
        key = body['key']
        if not key.startswith('images/recipes/') and not key.startswith('data/recipes/'):
            return _resp(400, {'error': 'key not allowed'})
        s3.delete_object(Bucket=S3_BUCKET, Key=key)
        return _resp(200, {'ok': True, 'key': key})
    
    # /contact (public, no auth)
    if path.endswith('/contact') and method == 'POST':
        name = (body.get('name') or '').strip()[:100]
        email = (body.get('email') or '').strip()[:200]
        phone = _clean_phone(body.get('phone'))             # NEW
        message = (body.get('message') or '').strip()[:3000]
        website = (body.get('website') or '').strip()[:100]
        ua = (body.get('ua') or '')[:400]
        lang = (body.get('lang') or '')[:10]
        page = (body.get('page') or '')[:500]

        if website:
            return _resp(200, {'ok': True})

        if not _valid_email(email) and not phone:
            return _resp(400, {'error': 'invalid input'})

        now = int(time.time())
        key = f"data/contacts/{now}.json"
        data = {
            'ts': now, 'name': name, 'email': email, 'phone': phone,   # NEW
            'message': message, 'ua': ua, 'lang': lang, 'page': page,
            'ip': (event.get('requestContext', {}).get('http', {}).get('sourceIp')
                or event.get('requestContext', {}).get('identity', {}).get('sourceIp'))
        }

        s3_write_json(key, data, cache_control='no-cache')

        if SNS_TOPIC_ARN:
            subject = f"[Recipes Journal] New message from {name}"
            # SNS email is plain text; keep it concise
            msg = (
                f"Name: {name}\n"
                f"Email: {email}\n"
                f"Phone: {phone or '-'}\n"
                f"Lang: {lang}\n"
                f"Page: {page}\n"
                f"UA: {ua}\n"
                f"Time: {now}\n\n"
                f"Message:\n{message}\n"
            )
            try:
                sns.publish(
                    TopicArn=SNS_TOPIC_ARN,
                    Subject=subject[:100],  # SNS caps subject length
                    Message=msg
                )
            except Exception as e:
                print(f"SNS publish failed: {e}")

        return _resp(200, {'ok': True})

    return _resp(404, {'error': 'not found'})
