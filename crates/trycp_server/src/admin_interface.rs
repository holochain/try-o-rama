use serde::Serialize;
use serde_derive::{Deserialize, Serialize};
use serde_json::Value;

use crate::rpc_util::internal_error;

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "type")]
enum AdminInterfaceMessage {
    Request {
        #[serde(rename = "id")]
        message_id: String,
        #[serde(with = "serde_bytes")]
        data: Vec<u8>,
    },
    Response {
        #[serde(rename = "id")]
        message_id: String,
        #[serde(with = "serde_bytes")]
        data: Vec<u8>,
    },
}

fn admin_request<T: Serialize>(data: T) -> Result<Vec<u8>, rmp_serde::encode::Error> {
    let data_buf = rmp_serde::to_vec_named(&data)?;
    let msg = AdminInterfaceMessage::Request {
        message_id: String::new(),
        data: data_buf,
    };
    rmp_serde::to_vec_named(&msg)
}

fn parse_admin_response(response: ws::Message) -> Result<Value, String> {
    let response_buf = match response {
        ws::Message::Binary(buf) => buf,
        r => return Err(format!("unexpected response from conductor: {:?}", r)),
    };
    let response_msg: AdminInterfaceMessage =
        rmp_serde::from_slice(&response_buf).map_err(|e| {
            format!(
                "failed to parse response from conductor as MessagePack: {}",
                e
            )
        })?;
    let response_data = match response_msg {
        AdminInterfaceMessage::Response { data, .. } => data,
        r => return Err(format!("unexpected message type from conductor: {:?}", r)),
    };
    rmp_serde::from_slice(&response_data).map_err(|e| {
        format!(
            "failed to parse response from conductor as MessagePack: {}",
            e
        )
    })
}

pub fn remote_call(
    port: u16,
    player_id: String,
    message: Value,
) -> Result<Value, jsonrpc_core::Error> {
    let message_buf = admin_request(message).expect("serialization cannot fail");
    let (res_tx, res_rx) = crossbeam::channel::bounded(1);
    let mut capture_vars = Some((res_tx, player_id, message_buf));
    ws::connect(format!("ws://localhost:{}", port), move |out| {
        // Even though this closure is only called once, the API requires FnMut
        // so we must use a workaround to take ownership of our captured variables
        let (res_tx, player_id, message_buf) = capture_vars.take().unwrap();

        let send_response = match out.send(message_buf) {
            Ok(()) => true,
            Err(e) => {
                res_tx.send(Err(internal_error(format!("failed to send message to player admin interface: {}", e)))).unwrap();
                if let Err(e) = out.close(ws::CloseCode::Error) {
                    println!("warning: silently ignoring error: failed to close admin interface connection: {}", e);
                }
                false
            }
        };
        move |response| {
            println!("received admin interface response from player {}: {:?}", player_id, response);
            if send_response {
                res_tx.send(Ok(response)).unwrap();
                out.close(ws::CloseCode::Normal)
            } else {
                println!("warning: ignoring admin interface response");
                Ok(())
            }
        }
    }).map_err(|e| internal_error(format!("failed to connect to player admin interface: {}", e)))?;

    let response = res_rx.recv().unwrap()?;
    parse_admin_response(response)
        .map_err(|e| internal_error(format!("failed to parse admin response: {}", e)))
}