<?php
while (ob_get_level() > 0) {
    if (!ob_end_clean()) break;
}
header_remove();
header('Content-Type: application/json; charset=utf-8');

ini_set('display_errors', 0);
error_reporting(E_ALL & ~E_NOTICE & ~E_STRICT & ~E_DEPRECATED);

// 配置�����离，加载 config.php
$config = require __DIR__ . '/config.php';

try {
    $input = @file_get_contents('php://input');
    $debug = [];
    if ($input === false || strlen($input) === 0) {
        $debug[] = "Empty or unreadable request body";
        throw new Exception("请求内容不可读");
    }

    $data = json_decode($input, true, 512, JSON_BIGINT_AS_STRING | JSON_THROW_ON_ERROR);
    if (json_last_error() !== JSON_ERROR_NONE) {
        $debug[] = "JSON decode error: " . json_last_error_msg();
        throw new Exception("请求体解析失败: " . json_last_error_msg());
    }

    $debug[] = "Received data: " . json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

    $message = trim($data['message'] ?? '');
    $history = $data['history'] ?? [];

    if (!is_array($history)) {
        $debug[] = "Invalid history format";
        throw new Exception("无效的历史数据格式");
    }

    if (empty($message)) {
        $debug[] = "Empty message";
        throw new Exception("消息内容不能为空");
    }
    if (strlen($message) > $config['max_length']) {
        $debug[] = "Message too long";
        throw new Exception("输入内容过长");
    }

    $debug[] = "Validated message: $message";
    $debug[] = "Validated history: " . json_encode($history, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

    $messagesChain = [
        ["role" => "system", "content" => "回答内容与思考过程不要重复"]
    ];

    foreach ($history as $record) {
        if (isset($record['role'], $record['content']) &&
            in_array($record['role'], ['user', 'assistant'])) 
        {
            $cleanContent = htmlspecialchars(
                mb_substr($record['content'], 0, $config['max_length'], 'UTF-8'),
                ENT_QUOTES,
                'UTF-8'
            );
            $messagesChain[] = [
                'role' => $record['role'],
                'content' => $cleanContent
            ];
        }
    }

    $currentMessage = mb_substr($message, 0, $config['max_length'], 'UTF-8');
    $messagesChain[] = ["role" => "user", "content" => $currentMessage];

    $initialCount = count($messagesChain);
    $totalToken = 0;
    foreach ($messagesChain as $msg) {
        $totalToken += ceil(mb_strlen($msg['content'], 'UTF-8') * 0.75);
    }

    $cutStart = 1;
    while ($totalToken > $config['max_context'] && count($messagesChain) > $cutStart) {
        $removedPair = array_splice($messagesChain, $cutStart, 2);
        foreach ($removedPair as $msg) {
            $totalToken -= ceil(mb_strlen($msg['content'], 'UTF-8') * 0.75);
        }
    }

    $ch = curl_init();
    $endpoint = sprintf(
        "https://api.cloudflare.com/client/v4/accounts/%s/ai/run/%s",
        $config['account_id'],
        $config['model']
    );

    curl_setopt_array($ch, [
        CURLOPT_URL            => $endpoint,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $config['api_token'],
            'Content-Type: application/json',
            'Accept: application/json'
        ],
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode([
            "messages" => $messagesChain,
            "temperature" => 0.7,
            "max_tokens"  => 1000
        ], JSON_THROW_ON_ERROR),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $config['timeout'],
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_ENCODING       => 'gzip'
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

    file_put_contents('debug.log', "HTTP Code: $httpCode\nResponse: $response\n", FILE_APPEND);

    if (curl_errno($ch)) {
        file_put_contents('debug.log', "cURL error: " . curl_error($ch) . "\n", FILE_APPEND);
        throw new Exception('请求失败: ' . curl_error($ch));
    }

    curl_close($ch);

    if ($httpCode !== 200) {
        file_put_contents('debug.log', "API returned HTTP $httpCode\n", FILE_APPEND);
        throw new Exception('API返回错误，HTTP状态码: ' . $httpCode . '，响应内容: ' . $response);
    }

    $result = json_decode($response, true, 512, JSON_THROW_ON_ERROR);

    // 兼容新API格式
    if (isset($result['result']['response'])) {
        $reply = $result['result']['response'];
    } elseif (isset($result['choices'][0]['message']['content'])) {
        $reply = $result['choices'][0]['message']['content'];
    } else {
        throw new Exception('API响应格式无效: ' . $response);
    }

    // 流式响应实现
    if (isset($result['result']['response'])) {
        // Cloudflare返回的内容可能包含markdown和latex公式，直接逐字符流式输出
        header('Content-Type: application/x-ndjson; charset=utf-8');
        header('Cache-Control: no-cache');
        header('X-Accel-Buffering: no');
        $text = $result['result']['response'];
        $buffer = '';
        // 按字符流式输出，遇到换行或每40字符输出一次
        for ($i = 0; $i < mb_strlen($text, 'UTF-8'); $i++) {
            $buffer .= mb_substr($text, $i, 1, 'UTF-8');
            if (mb_strlen($buffer, 'UTF-8') >= 40 || $buffer === "\n" || $i === mb_strlen($text, 'UTF-8') - 1) {
                echo json_encode(["content" => $buffer], JSON_UNESCAPED_UNICODE) . "\n";
                @ob_flush();
                @flush();
                $buffer = '';
                usleep(50000); // 更快流式体验
            }
        }
        exit;
    } elseif (isset($result['choices'][0]['message']['content'])) {
        // 兼容旧格式
        $chunks = preg_split('/(\n|<think>|<\/think>)/', $result['choices'][0]['message']['content']);
        foreach ($chunks as $chunk) {
            $chunk = trim($chunk);
            if ($chunk !== '') {
                echo json_encode(["content" => $chunk], JSON_UNESCAPED_UNICODE) . "\n";
                @ob_flush();
                @flush();
                usleep(100000);
            }
        }
    } else {
        throw new Exception('API响应格式无效: ' . $response);
    }
    exit;

} catch (Exception $e) {
    http_response_code(400);
    echo json_encode([
        'status' => 'error',
        'message' => $e->getMessage(),
        'debug' => $debug
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
}
