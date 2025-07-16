<?php
while (ob_get_level() > 0) {
    if (!ob_end_clean()) break;
}
header_remove();
header('Content-Type: application/json; charset=utf-8');

ini_set('display_errors', 0);
error_reporting(E_ALL & ~E_NOTICE & ~E_STRICT & ~E_DEPRECATED);

const CONFIG = [
    'api_token'    => '待填写',
    'account_id'   => '待填写',
    'model'        => '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    'timeout'      => 50,
    'max_length'   => 10000,
    'max_history'  => 6,
    'max_context'  => 4096
];

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
    if (strlen($message) > CONFIG['max_length']) {
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
                mb_substr($record['content'], 0, CONFIG['max_length'], 'UTF-8'),
                ENT_QUOTES,
                'UTF-8'
            );
            $messagesChain[] = [
                'role' => $record['role'],
                'content' => $cleanContent
            ];
        }
    }

    $currentMessage = mb_substr($message, 0, CONFIG['max_length'], 'UTF-8');
    $messagesChain[] = ["role" => "user", "content" => $currentMessage];

    $initialCount = count($messagesChain);
    $totalToken = 0;
    foreach ($messagesChain as $msg) {
        $totalToken += ceil(mb_strlen($msg['content'], 'UTF-8') * 0.75);
    }

    $cutStart = 1;
    while ($totalToken > CONFIG['max_context'] && count($messagesChain) > $cutStart) {
        $removedPair = array_splice($messagesChain, $cutStart, 2);
        foreach ($removedPair as $msg) {
            $totalToken -= ceil(mb_strlen($msg['content'], 'UTF-8') * 0.75);
        }
    }

    $ch = curl_init();
    $endpoint = sprintf(
        "https://api.cloudflare.com/client/v4/accounts/%s/ai/run/%s",
        CONFIG['account_id'],
        CONFIG['model']
    );

    curl_setopt_array($ch, [
        CURLOPT_URL            => $endpoint,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . CONFIG['api_token'],
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
        CURLOPT_TIMEOUT        => CONFIG['timeout'],
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

    if (!isset($result['choices'][0]['message']['content'])) {
        file_put_contents('debug.log', "Invalid API response format\n", FILE_APPEND);
        throw new Exception('API响应格式无效: ' . $response);
    }

    $output = [
        'status' => 'success',
        'message' => '请求成功',
        'data' => [
            'response' => $result['choices'][0]['message']['content']
        ]
    ];

    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($output, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

} catch (Exception $e) {
    http_response_code(400);
    echo json_encode([
        'status' => 'error',
        'message' => $e->getMessage(),
        'debug' => $debug
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
}
